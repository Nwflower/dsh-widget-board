/** 官方公开入口；颜色只用于界面调色，图案均为原创装饰。 */
import type { Degree, SchoolPreset } from './types'

export const DEGREES: Record<Degree, { zh: string, en: string, categories: readonly string[], milestones: readonly string[] }> = {
  undergraduate: { zh: '本科生', en: 'Undergraduate', categories: ['考试', '作业', '课程项目', '选课', '竞赛'], milestones: ['实习', '毕业设计', '升学申请'] },
  master: { zh: '硕士生', en: 'Master’s', categories: ['投稿', '返修', '组会', '项目交付'], milestones: ['开题', '中期', '送审', '答辩'] },
  doctoral: { zh: '博士生', en: 'Doctoral', categories: ['投稿', '返修', '基金申请', '学术报告'], milestones: ['资格考核', '中期', '预答辩', '答辩', '求职'] },
}
export const SCHOOLS: readonly SchoolPreset[] = [
  { id: 'generic', zh: '我的校园', en: 'My campus', short: '校园', color: '#627867', pattern: 'book', links: [], sources: [], checked: '2026-10-25' },
  { id: 'bupt', zh: '北京邮电大学', en: 'Beijing University of Posts and Telecommunications', short: '北邮', color: '#4c7090', pattern: 'signal', checked: '2026-10-25',
    links: [{ id: 'bupt-home', title: '学校官网', url: 'https://www.bupt.edu.cn/' }, { id: 'bupt-library', title: '图书馆', url: 'https://lib.bupt.edu.cn/' }],
    sources: ['https://www.bupt.edu.cn/', 'https://libportal.bupt.edu.cn/a/ruguanzhinan/changjianwenti/'] },
  { id: 'bit', zh: '北京理工大学', en: 'Beijing Institute of Technology', short: '北理', color: '#607c68', pattern: 'building', checked: '2026-10-25',
    links: [{ id: 'bit-home', title: '学校官网', url: 'https://www.bit.edu.cn/' }, { id: 'bit-library', title: '图书馆', url: 'https://lib.bit.edu.cn/' }, { id: 'bit-undergraduate', title: '本科生教育', url: 'https://jwc.bit.edu.cn/' }, { id: 'bit-graduate', title: '研究生教育', url: 'https://grd.bit.edu.cn/' }],
    sources: ['https://www.bit.edu.cn/', 'https://www.bit.edu.cn/dhw/zxs/index.htm', 'https://lib.bit.edu.cn/'] },
  { id: 'xmu', zh: '厦门大学', en: 'Xiamen University', short: '厦大', color: '#547c96', pattern: 'roof', checked: '2026-10-25',
    links: [{ id: 'xmu-home', title: '学校官网', url: 'https://www.xmu.edu.cn/' }, { id: 'xmu-library', title: '图书馆', url: 'https://library.xmu.edu.cn/' }, { id: 'xmu-undergraduate', title: '本科生教育', url: 'https://jwc.xmu.edu.cn/' }, { id: 'xmu-graduate', title: '研究生教育', url: 'https://gs.xmu.edu.cn/' }],
    sources: ['https://www.xmu.edu.cn/', 'https://library.xmu.edu.cn/'] },
  { id: 'csu', zh: '中南大学', en: 'Central South University', short: '中南', color: '#566f8c', pattern: 'mountain', checked: '2026-10-25',
    links: [{ id: 'csu-home', title: '学校官网', url: 'https://www.csu.edu.cn/' }, { id: 'csu-library', title: '图书馆', url: 'https://lib.csu.edu.cn/' }, { id: 'csu-undergraduate', title: '本科生教育', url: 'https://bksy.csu.edu.cn/' }, { id: 'csu-graduate', title: '研究生教育', url: 'https://gra.csu.edu.cn/' }],
    sources: ['https://www.csu.edu.cn/'] },
  { id: 'custom', zh: '自定义学校', en: 'Custom school', short: '自定', color: '#74796b', pattern: 'book', links: [], sources: [], checked: '2026-10-25' },
]
