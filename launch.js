'use strict'

const logger = require('./lib/logger')
const DMClient = require('./dm_client')

const client = new DMClient()
  .on('connect', () => { logger.info('连接弹幕服务器成功') })
  // 弹幕
  .on('DANMU_MSG', json => {
    logger.info(`${json['info'][2][1]}: ${json['info'][1]}`)
  })
  // 送礼
  .on('SEND_GIFT', json => {
    logger.info(`${json['data']['uname']}赠送${json['data']['giftName']}`+
      `×${json['data']['num']}`)
  })
  // 老爷进直播间通知
  .on('WELCOME', json => {
    logger.info(`【${json['data']['svip'] ? '年费' : ''}老爷】`+
      `${json['data']['uname']}进入直播间`)
  })
  // 舰长进直播间通知
  .on('WELCOME_GUARD', json => {
    let guard = ['', '总督', '提督', '舰长']
    logger.info(`【${guard[json['data']['guard_level']]}】`+
      `${json['data']['username']}进入直播间`)
  })
  // 购买舰长通知
  .on('GUARD_BUY', json => {
    let guard = ['', '总督', '提督', '舰长']
    logger.info(`${json['data']['username']}`+
      `购买${guard[json['data']['guard_level']]}`)
  })
  // 禁言通知
  .on('ROOM_BLOCK_MSG', json => { logger.info(`${json['uname']}被禁言`) })
  // 小电视抽奖
  .on('SYS_MSG', function (json) { getTVEnd(json) })
  // 活动抽奖
  .on('SYS_GIFT', function (json) { getRaffleEnd(json) })



let tvClients = {}
let raffleClients = {}

// 获取当前小电视抽奖的最终大奖结果
function getTVEnd(json) {
  const roomid = json['real_roomid']
  // 首先判断该消息是否为小电视抽奖消息
  if (/小电视一个/.test(json['msg'])) {
    // 然后判断当前直播间的DMClient是否已经存在
    if (tvClients[roomid]) {
      // 存在则将其计数加一
      tvClients[roomid].count++
    } else {
      // 否则新建一个DMClient
      tvClients[roomid] = new DMClient(roomid, false)
      tvClients[roomid].count = 1 // 该变量用来标记当前直播间存在多少个未开奖的小电视
      tvClients[roomid]
        .on('TV_END', function (json) {
          logger.info(`${json.data.win.uname}获得${json.data.win.giftName}`+
            `×${json.data.win.giftNum}`)
          if ((--this.count) <= 0) {
            this.close()
            tvClients[roomid] = undefined
          }
        })
        .on('close', function () {
          logger.info(`已关闭直播间【${this.roomid}】的弹幕客户端`)
        })
        .connect()
    }
  }
}

// 获取当前活动抽奖的最终大奖结果
function getRaffleEnd(json) {
  const roomid = json['real_roomid']
  // 首先判断该消息是否为新春抽奖消息
  if (/邂逅/.test(json['msg'])) {
    // 然后判断当前直播间的DMClient是否已经存在
    if (raffleClients[roomid]) {
      // 存在则将其计数加一
      raffleClients[roomid].count++
    } else {
      // 否则新建一个DMClient
      raffleClients[roomid] = new DMClient(roomid, false)
      raffleClients[roomid].count = 1 // 该变量用来标记当前直播间存在多少个未开奖的活动抽奖
      raffleClients[roomid]
        .on('RAFFLE_END', function (json) {
          logger.info(`${json.data.win.uname}获得${json.data.win.giftName}`+
            `×${json.data.win.giftNum}`)
          if ((--this.count) <= 0) {
            this.close()
            raffleClients[roomid] = undefined
          }
        })
        .on('close', function () {
          logger.info(`已关闭直播间【${this.roomid}】的弹幕客户端`)
        })
        .connect()
    }
  }
}


client.connect()
