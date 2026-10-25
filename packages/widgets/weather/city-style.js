/*
 * 城市到场景：同一个城市每次打开都是同一种风景，用户也能在设置里直接指定。
 *
 * 只按地名关键词匹配，不联网也不查表；匹配不到时给现代都市。轮播按 `ORDER` 走一圈。
 */
;(function (root) {
  'use strict'

  /** 关键词 → 场景。先匹配到的先用，所以把更有辨识度的城市放在前面。 */
  var PROFILES = [
    { scene: 'heritage', match: ['北京', 'beijing', '西安', "xi'an", 'xian', '洛阳', 'luoyang', '开封', 'kaifeng', '南京', 'nanjing', '拉萨', 'lhasa', '京都', 'kyoto', '奈良', 'nara', '平遥', 'pingyao', '敦煌', 'dunhuang'] },
    { scene: 'ink', match: ['杭州', 'hangzhou', '苏州', 'suzhou', '黄山', 'huangshan', '桂林', 'guilin', '丽江', 'lijiang', '绍兴', 'shaoxing', '扬州', 'yangzhou', '景德镇', 'jingdezhen'] },
    { scene: 'court', match: ['成都', 'chengdu', '扬州', 'yangzhou', '徽州', 'huizhou', '婺源', 'wuyuan', '周庄', 'zhouzhuang', '乌镇', 'wuzhen', '泉州', 'quanzhou'] },
    { scene: 'city', match: ['上海', 'shanghai', '深圳', 'shenzhen', '广州', 'guangzhou', '香港', 'hong kong', '重庆', 'chongqing', '东京', 'tokyo', '首尔', 'seoul', '新加坡', 'singapore', '纽约', 'new york', '伦敦', 'london', '巴黎', 'paris', '迪拜', 'dubai', '悉尼', 'sydney'] },
  ]

  /** 轮播的次序：把几座城市走一遍，再进古建、庭院与水墨。 */
  var ORDER = ['beijing', 'shanghai', 'newyork', 'tokyo', 'london', 'cyberpunk', 'city', 'heritage', 'court', 'ink']

  /** 设置里可选的场景名，`auto` 表示按城市挑。 */
  var CHOICES = ['auto', 'beijing', 'shanghai', 'newyork', 'tokyo', 'london', 'cyberpunk', 'city', 'heritage', 'court', 'ink']

  /** 城市档案：每个街景一份，`auto` 与地名匹配到的那一条决定看哪座城。 */
  var CITIES = [
    { id: 'beijing', match: ['北京', 'beijing', '中国尊', 'cbd', '国贸', '朝阳'] },
    { id: 'shanghai', match: ['上海', 'shanghai', '陆家嘴', 'lujiazui', '浦东', 'pudong'] },
    { id: 'newyork', match: ['纽约', 'new york', 'newyork', '曼哈顿', 'manhattan', '时代广场', 'times square'] },
    { id: 'tokyo', match: ['东京', 'tokyo', '涩谷', 'shibuya', '新宿', 'shinjuku', '秋叶原', 'akihabara'] },
    { id: 'london', match: ['伦敦', 'london', '泰晤士', 'thames', '金融城', 'canary wharf'] },
    { id: 'cyberpunk', match: ['赛博', 'cyber', 'neon', '霓虹', '未来', 'futuristic'] },
  ]

  /**
   * 按地名挑一个场景。
   *
   * @param place - 组件的 props.place，形如 `{ zh, en }`。
   * @returns `city`、`heritage`、`court` 或 `ink`。
   */
  function resolve(place) {
    var names = [place && place.zh, place && place.en].filter(function (value) { return typeof value === 'string' })
    for (var c = 0; c < CITIES.length; c += 1) {
      for (var m = 0; m < CITIES[c].match.length; m += 1) {
        for (var n2 = 0; n2 < names.length; n2 += 1) {
          if (names[n2].toLowerCase().indexOf(CITIES[c].match[m]) >= 0) return CITIES[c].id
        }
      }
    }
    for (var p = 0; p < PROFILES.length; p += 1) {
      for (var n = 0; n < names.length; n += 1) {
        var haystack = names[n].toLowerCase()
        for (var k = 0; k < PROFILES[p].match.length; k += 1) {
          if (haystack.indexOf(PROFILES[p].match[k]) >= 0) return PROFILES[p].scene
        }
      }
    }
    return 'city'
  }

  /** 下一个轮播场景。 */
  function next(scene) {
    var at = ORDER.indexOf(scene)
    return ORDER[(at + 1) % ORDER.length]
  }

  root.WxCityStyle = { resolve: resolve, next: next, order: ORDER, choices: CHOICES, cities: CITIES }
})(window)
