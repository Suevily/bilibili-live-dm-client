'use strict'

const fs = require('fs')
const path = require('path')
const log4js = require('log4js')
const config = require('../config')

const logsDir = path.parse(config.logPath).dir
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir)
}

log4js.configure({
  appenders: {
    console: { type: 'console' },
    dateFile: { type: 'dateFile', filename: config.logPath, pattern: '-yyyy-MM-dd' }
  },
  categories: {
    default: {
      appenders: ['console', 'dateFile'],
      level: 'info'
    }
  }
})

const logger = log4js.getLogger()

module.exports = logger