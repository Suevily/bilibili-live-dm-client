'use strict'

const logger = require('./lib/logger') // 用于打log的模块
const { EventEmitter } = require('events') // DMClient的原型，可以emit信号
const { Socket } = require('net') // 用于连接弹幕服务器的一个module (flash协议)
const { inflateSync } = require('zlib') // 用于解压B站服务器发来的原始数据包的一个module

class DMClient extends EventEmitter {

  // 构造函数
  constructor(roomid = 2, keepAlive = true) {
    super()
    this.roomid = roomid // 这里是真实的roomid，注意与直播间短号进行区分
    this.uid = parseInt(100000000000000.0 + 200000000000000.0 * Math.random()) // 套用公式随机生成
    this.serverAddr = 'livecmt-2.bilibili.com' // 服务器地址可能会更改
    this.port = 2243 // flash协议的端口，可能会更改
    this.connected = false // 还未连接
    this.keepAlive = keepAlive // 该变量用来标记当前client是否需要长期连接不断线
    this.startTime = Date.now() // client创建时间戳
  }

  // 连接弹幕服务器，目前使用的是flash协议
  connect(port = this.port, serverAddr = this.serverAddr) {
    if (this.connected) return
    this.port = port
    this.serverAddr = serverAddr
    this.socket = new Socket().connect(port, serverAddr)
      .on('connect', () => this.sendJoinRequest())
      .on('data', data => this.handleData(data))
      .on('end', () => { this.close() })
      .on('error', err => {
        // 出错的话摧毁当前socket并重新连接
        logger.info(`出错：${err}`)
        this.close()
        this.connect()
        if (this.keepAlive === false) {
          // 不是用来挂机的客户端生存周期为3分钟
          setTimeout(function () {
            this.close()
          }, 3 * 60 * 1000 - (Date.now() - this.startTime))
        }
      })
    this.connected = true
  }

  // 关闭客户端前所需要做的工作
  close() {
    if (this.socket == undefined) return
    logger.info('摧毁当前socket...')
    clearInterval(this.intervalId) // 取消心跳包的发送
    clearTimeout(this.timeoutId) // 取消未完成的延时回调
    // 摧毁出错的socket
    this.socket.end()
    this.socket.destroy()
    this.socket.removeAllListeners()
    // 设置标记为未连接
    this.connected = false
    // emit关闭信号
    this.emit('close')
  }

  // 发送一个进入直播间的请求
  sendJoinRequest() {
    this.emit('connect') // 连接弹幕服务器成功，emit信号
    let data = JSON.stringify({
      roomid: this.roomid,
      uid: this.uid,
      protover: 2, // 猜测为协议版本
      platform: 'flash',
      clientver: '2.1.8-02af452c' // 猜测为客户端版本
    })
    this.sendData(0x10 + data.length, 0x10, 0x01, 0x07, 0x01, data)
    
    // 每30秒发送一个心跳包
    this.intervalId = setInterval(() => {
      let data = JSON.stringify({ uid: this.uid, roomid: this.roomid })
      this.sendData(16 + data.length, 0x10, 0x01, 0x02, 0x01, data)

      // 设置一个10秒钟的延时回调来判断心跳超时
      this.timeoutId = setTimeout(() => {
         // 如果该函数被调用证明心跳超时，摧毁当前socket并尝试重连
         logger.info('心跳超时，正在尝试重新连接...')
         this.close()
         this.connect()
      }, 10 * 1000)
    }, 30 * 1000)
  }

  // 处理从弹幕服务器发来的原始数据
  handleData(data) {
    // 拼接数据
    if (this.cacheData !== undefined) {
      // 把数据合并到缓存
      this.cacheData = Buffer.concat([this.cacheData, data])
      const dataLen = this.cacheData.length // 数据包的真实大小
      const packageLen = this.cacheData.readInt32BE(0) // 数据包的标记大小
      if (dataLen >= packageLen) {
        data = this.cacheData
        delete this.cacheData
      } else return
    }

    const dataLen = data.length // 数据包的真实大小
    const packageLen = data.readInt32BE(0) // 数据包的标记大小
    // 等待拼接数据
    if (dataLen < packageLen) return this.cacheData = data

    // 数据长度0x14时为在线人数, 大于0x14的数据为弹幕信息，可能需要进行解压处理
    if (packageLen > 0x14) {
      if (data.readInt16BE(16) === 0x78DA) { // 信息主体以78 DA开头的数据是被压缩过的数据
        let uncompressData = inflateSync(data.slice(16, packageLen)) // 将信息主体解压成新的数据包
        if (data == undefined) return // 丢弃解压失败的数据
        else {
          this.handleData(uncompressData)
          if (dataLen > packageLen) this.handleData(data.slice(packageLen))
          return
        }
      }
    }

    // 解析处理完的数据包
    this.parseData(data.slice(0, packageLen))
    if (dataLen > packageLen) this.handleData(data.slice(packageLen))
  }

  // 解析已经过拼接、解压等处理的数据
  parseData(data) {
    const packageLen = data.readInt32BE(0) // 数据包的标记大小

    switch (data.readInt32BE(8)) {
      case 0x08: 
        // 进入直播间成功后会返回的一个消息头
        // 00 00 00 10 00 10 00 01  00 00 00 08 00 00 00 01
        logger.info(`进入直播间【${this.roomid}】成功`)
        break
      case 0x01:
      case 0x02:
      case 0x03: 
        // 在线人数 (接收到该数据证明心跳没有超时)
        clearTimeout(this.timeoutId)
        logger.info(`【心跳反馈】直播间【${this.roomid}】当前人气值: ${data.readInt32BE(16)}`)
        break
      case 0x05: 
        // 弹幕信息
        let json = JSON.parse(data.toString('UTF-8', 16))
        switch (json['cmd']) {
          case 'DANMU_MSG':       // 弹幕
          case 'SEND_GIFT':       // 送礼
          case 'WELCOME':         // 老爷进直播间通知
          case 'WELCOME_GUARD':   // 舰长进直播间通知
          case 'GUARD_BUY':       // 购买舰长通知
          case 'SYS_MSG':         // 全站通告，包含小电视抽奖消息
          case 'TV_START':        // 当前直播间小电视抽奖开始消息
          case 'TV_END':          // 小电视抽奖大奖结果
          case 'SYS_GIFT':        // 触发全站通告的送礼消息，包含活动抽奖消息
          case 'RAFFLE_START':    // 当前直播间活动抽奖开始消息
          case 'RAFFLE_END':      // 活动抽奖大奖结果
          case 'SPECIAL_GIFT':    // 节奏风暴
          case 'WISH_BOTTLE':     // 愿望瓶更新的通知
          case 'ACTIVITY_EVENT':  // 喜气值改变的通知
          case 'WELCOME_ACTIVITY':// 大佬的进直播间动画
          case 'ROOM_BLOCK_MSG':  // 禁言通知
          case 'EVENT_CMD':       // 不知道是什么鬼，貌似活动抽奖就会有
          case 'PREPARING':       // 直播准备状态
          case 'ROOM_SILENT_OFF': // 下播通知
            // emit该信号，在外部进行处理
            this.emit(json['cmd'], json)
            break
          default: // 其他未知类型的通知
            // 直接打log输出
            logger.info(`直播间【${this.roomid}】${JSON.stringify(json, null, ' ')}`)
            break;
        }
        break

    }
  }

  // 向服务器发送数据
  sendData(totalLen = 0x10, headLen = 0x10, version = 0x01, type = 0x01, device = 0x01, data = '') {
    const buf = Buffer.allocUnsafe(totalLen)
    // 消息头，默认为：
    // 00 00 00 10   00 10   00 01     00 00 00 07   00 00 00 01
    buf.writeInt32BE(totalLen, 0)
    buf.writeInt16BE(headLen, 4)
    buf.writeInt16BE(version, 6)
    buf.writeInt32BE(type, 8)
    buf.writeInt32BE(device, 12)
    // 消息主体
    if (data) buf.write(data, headLen)

    this.socket.write(buf)
  }
}

module.exports = DMClient
