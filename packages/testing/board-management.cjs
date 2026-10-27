#!/usr/bin/env node
'use strict'
/**
 * board-management.cjs — 看板标签的就地管理（D21、B1）。
 *
 * 走查只用插件自己的标记。核对的是用户看得见的行为：更多按钮与标签右键打开同一张菜单、从别的
 * 标签打开不切换看板、关闭之后焦点回到触发按钮、改名按钮的宽窄跟着变、中文输入法组合期间的回车
 * 不保存、删除确认报出标题与两个数、删当前与非当前的看板都回到宿主给的选中项、删最后一块之后
 * 还剩一块空的。走查结束时把多出来的看板收掉，后面的场景仍只有原来那一块。
 */

const TABS = '[data-dsh-widget-board-tabs]'
const TAB = '[data-dsh-widget-board-tab]'
const MORE = '[data-dsh-widget-board-tab-more]'
const NEW_TAB = '[data-dsh-widget-board-tab-new]'
const MENU = '[data-dsh-widget-board-board-menu]'
const MENU_RENAME = '[data-dsh-widget-board-board-menu-action="rename"]'
const MENU_REMOVE = '[data-dsh-widget-board-board-menu-action="remove"]'
const RENAME = '[data-dsh-widget-board-rename-board]'
const RENAME_INPUT = '[data-dsh-widget-board-rename-input]'
const RENAME_SAVE = '[data-dsh-widget-board-rename-save]'
const RENAME_CANCEL = '[data-dsh-widget-board-rename-cancel]'
const RENAME_NOTE = '[data-dsh-widget-board-rename-note]'
const DELETE = '[data-dsh-widget-board-delete-board]'
const DELETE_CONFIRM = '[data-dsh-widget-board-delete-confirm]'
const DELETE_CANCEL = '[data-dsh-widget-board-delete-cancel]'
const DELETE_NAME = '[data-dsh-widget-board-delete-name]'
const DELETE_CELLS = '[data-dsh-widget-board-delete-cells]'
const DELETE_CARDS = '[data-dsh-widget-board-delete-cards]'
const VIEW = '[data-dsh-widget-board-view]'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 读一次标签条的现状：标签 id、选中项、活动标签与药丸的盒子。 */
async function strip(page) {
  return await page.evaluate(({ tabs, tab, pill }) => {
    const node = document.querySelector(tabs)
    const buttons = node === null ? [] : Array.from(node.querySelectorAll(tab))
    const active = buttons.find((button) => button.getAttribute('aria-selected') === 'true')
    const marker = node === null ? null : node.querySelector(pill)
    const box = (element) => {
      if (element === null) return null
      const rect = element.getBoundingClientRect()
      return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height), right: Math.round(rect.right) }
    }
    return {
      ids: buttons.map((button) => button.getAttribute('data-dsh-widget-board-tab')),
      labels: buttons.map((button) => (button.textContent ?? '').trim()),
      selected: active?.getAttribute('data-dsh-widget-board-tab') ?? null,
      active: box(active ?? null),
      pill: box(marker),
      group: box(node === null ? null : node),
    }
  }, { tabs: TABS, tab: TAB, pill: '[data-dsh-widget-board-tabs-pill]' })
}

/** 按 id 打开某一块的更多菜单。 */
async function openMenu(page, id) {
  await page.locator(`${MORE}[data-dsh-widget-board-tab-more="${id}"]`).click()
  await page.waitForSelector(MENU, { timeout: 5000 })
}

/** 菜单与两个弹窗都关掉。 */
async function closed(page) {
  const menu = await page.locator(MENU).count()
  const rename = await page.locator(RENAME).count()
  const remove = await page.locator(DELETE).count()
  return menu === 0 && rename === 0 && remove === 0
}

/**
 * 一趟看板管理的走查。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param context - 这一层共用的判定。
 */
async function boardManagementPass(page, { check }) {
  await page.waitForSelector(TABS, { timeout: 10000 })
  const before = await strip(page)
  const base = before.selected
  check('初始只有一块看板', before.ids.length === 1 && base !== null, JSON.stringify(before.ids))

  // 建一块临时看板：后面核对的「非当前标签」要用它。
  await page.locator(NEW_TAB).click()
  await page.waitForFunction(({ tabs, count }) => document.querySelectorAll(`${tabs} [data-dsh-widget-board-tab]`).length === count + 1, { tabs: TABS, count: before.ids.length }, { timeout: 10000 })
  const created = await strip(page)
  const second = created.selected
  check('新建之后多一块看板并选中它', created.ids.length === 2 && second !== null && second !== base, JSON.stringify(created.selected))

  try {
    // B02：非当前标签打开菜单不切换看板。
    await openMenu(page, base)
    const staying = await strip(page)
    check('从非当前标签打开菜单不切换看板', staying.selected === second, `${String(staying.selected)} / 期望 ${String(second)}`)
    const menu = page.locator(MENU)
    const actions = await menu.locator('[role="menuitem"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-dsh-widget-board-board-menu-action')))
    check('菜单里有改名与移除两项', actions.length === 2 && actions.includes('rename') && actions.includes('remove'), JSON.stringify(actions))
    check('菜单写着它管的是哪一块', (await menu.textContent())?.includes((await page.locator(`[data-dsh-widget-board-tab="${base}"]`).textContent()) ?? '') === true)

    // B01：Escape 关闭并归还焦点。焦点回来是在这一轮事件走完之后，等它落定再判。
    await page.keyboard.press('Escape')
    await page.waitForFunction((selector) => document.querySelector(selector) === null, MENU, { timeout: 5000 })
    const afterEscape = await page.evaluate(async (id) => {
      await new Promise((resolve) => setTimeout(resolve, 120))
      return document.activeElement?.getAttribute('data-dsh-widget-board-tab-more') === id
    }, base)
    check('Escape 关掉菜单并把焦点还给更多按钮', afterEscape === true && await closed(page), String(afterEscape))

    // B01：外部点击关闭并把焦点还回去。
    await openMenu(page, base)
    await page.mouse.click(5, 5)
    await page.waitForFunction((selector) => document.querySelector(selector) === null, MENU, { timeout: 5000 })
    const afterOutside = await page.evaluate(async (id) => {
      await new Promise((resolve) => setTimeout(resolve, 120))
      return document.activeElement?.getAttribute('data-dsh-widget-board-tab-more') === id
    }, base)
    check('外部点击关掉菜单并把焦点还给更多按钮', afterOutside === true && await closed(page), String(afterOutside))

    // B03：标签右键打开同一个菜单，同样不切换。
    await page.locator(`[data-dsh-widget-board-tab="${base}"]`).click({ button: 'right' })
    await page.waitForSelector(MENU, { timeout: 5000 })
    const rightClick = await strip(page)
    check('标签右键打开同一张菜单且不切换看板', await page.locator(MENU).count() === 1 && rightClick.selected === second,
      `${String(rightClick.selected)} / 期望仍是 ${String(second)}`)
    await page.keyboard.press('Escape')
    await page.waitForFunction((selector) => document.querySelector(selector) === null, MENU, { timeout: 5000 })

    // V08：标签的语义与键盘。标签里不能再套按钮，更多按钮自己是一个可聚焦控件，菜单首项拿到焦点，
    // 方向键在两项之间绕行，aria-expanded 跟着开合走。
    const semantics = await page.evaluate(({ tabs, tab, more }) => {
      const strip = document.querySelector(tabs)
      const groups = Array.from(strip?.querySelectorAll('[data-dsh-widget-board-tab-group]') ?? [])
      return {
        // tab 里再套按钮会让读屏把切换与「更多」读成同一个控件。
        nested: groups.filter((group) => [...(group.querySelector(`${tab}[role="tab"]`)?.querySelectorAll('button') ?? [])].length > 0).length,
        perGroup: groups.map((group) => group.querySelectorAll('button').length),
        moreCount: strip === null ? 0 : strip.querySelectorAll(more).length,
        tabsCount: strip === null ? 0 : strip.querySelectorAll(`${tab}[role="tab"]`).length,
        expandedClosed: Array.from(strip?.querySelectorAll(more) ?? []).map((node) => node.getAttribute('aria-expanded')),
        haspops: Array.from(strip?.querySelectorAll(more) ?? []).every((node) => node.getAttribute('aria-haspopup') === 'menu'),
      }
    }, { tabs: TABS, tab: TAB, more: MORE })
    check('切换按钮里没有再套按钮', semantics.nested === 0, JSON.stringify(semantics.perGroup))
    check('每块标签各有一枚更多按钮，文字按钮才是 tab',
      semantics.moreCount === semantics.tabsCount && semantics.tabsCount >= 1, JSON.stringify(semantics))
    check('更多按钮声明自己弹出菜单，收起时 aria-expanded 为假',
      semantics.haspops === true && semantics.expandedClosed.every((value) => value === 'false'), JSON.stringify(semantics.expandedClosed))

    // 键盘打开：Tab 到更多按钮，回车开菜单，焦点落在第一项。
    await page.locator(MORE).first().focus()
    await page.keyboard.press('Enter')
    await page.waitForSelector(MENU, { timeout: 5000 })
    const firstFocus = await page.evaluate((selector) => document.activeElement?.getAttribute('data-dsh-widget-board-board-menu-action'), { selector: MENU })
    check('键盘打开菜单后焦点落在第一项', firstFocus === 'rename', String(firstFocus))
    const expandedOpen = await page.evaluate((more) => Array.from(document.querySelectorAll(more)).some((node) => node.getAttribute('aria-expanded') === 'true'), MORE)
    check('菜单开着时 aria-expanded 为真', expandedOpen === true, String(expandedOpen))
    await page.keyboard.press('ArrowDown')
    const secondFocus = await page.evaluate(() => document.activeElement?.getAttribute('data-dsh-widget-board-board-menu-action'))
    await page.keyboard.press('ArrowDown')
    const wrapped = await page.evaluate(() => document.activeElement?.getAttribute('data-dsh-widget-board-board-menu-action'))
    check('方向键在两项之间移动并绕回第一项', secondFocus === 'remove' && wrapped === 'rename', `${String(secondFocus)} / ${String(wrapped)}`)
    await page.keyboard.press('Tab')
    await page.waitForFunction((selector) => document.querySelector(selector) === null, MENU, { timeout: 5000 })
    check('Tab 离开菜单时菜单收起', await closed(page))

    // B04、B06：改名成功、宽度跟着变。
    const original = await page.locator(`[data-dsh-widget-board-tab="${base}"]`).textContent()
    const widthBefore = (await strip(page)).ids.length === 2 ? (await page.locator(`[data-dsh-widget-board-tab-group="${base}"]`).boundingBox())?.width ?? 0 : 0
    await openMenu(page, base)
    await page.locator(MENU_RENAME).click()
    await page.waitForSelector(RENAME, { timeout: 5000 })
    check('改名弹窗预填当前名字', await page.locator(RENAME_INPUT).inputValue() === (original ?? '').trim(), await page.locator(RENAME_INPUT).inputValue())
    const longName = 'T01 看板管理走查用的长名字'
    await page.locator(RENAME_INPUT).fill(longName)
    await page.locator(RENAME_SAVE).click()
    await page.waitForFunction(({ tab, title }) => document.querySelector(`${tab}[title="${title}"]`) !== null, { tab: TAB, title: longName }, { timeout: 10000 }).catch(() => {})
    const renamed = await strip(page)
    // 药丸滑到新位置需要一次补间：等它停稳再量。
    await page.waitForFunction(({ tabs, pill, tab }) => {
      const strip = document.querySelector(tabs)
      const marker = strip?.querySelector(pill)
      const active = strip?.querySelector(`[data-dsh-widget-board-tab-group="${CSS.escape(strip?.querySelector(`${tab}[aria-selected="true"]`)?.getAttribute('data-dsh-widget-board-tab') ?? '')}"]`)
      if (marker == null || active == null) return false
      const left = marker.getBoundingClientRect()
      const target = active.getBoundingClientRect()
      return Math.abs(left.left - target.left) <= 2 && Math.abs(left.width - target.width) <= 2
    }, { tabs: TABS, pill: '[data-dsh-widget-board-tabs-pill]', tab: TAB }, { timeout: 5000 })
    const settled = await strip(page)
    const widthAfter = (await page.locator(`[data-dsh-widget-board-tab-group="${base}"]`).boundingBox())?.width ?? 0
    check('改名之后标签文字是新的', renamed.labels.includes(longName), JSON.stringify(renamed.labels))
    check('改名之后药丸仍套住活动那一组',
      settled.pill !== null && settled.active !== null
      && Math.abs(settled.pill.left - settled.active.left) <= 2
      && Math.abs(settled.pill.width - settled.active.width) <= 2,
      `${JSON.stringify(settled.pill)} / ${JSON.stringify(settled.active)}`)
    check('标题变长之后标签跟着变宽', widthAfter > widthBefore, `${widthAfter} / ${widthBefore}`)

    // B04：空白名字就近报错，不提交。填过空白之后提示换成原因，保存按钮不可按。
    await openMenu(page, base)
    await page.locator(MENU_RENAME).click()
    await page.waitForSelector(RENAME, { timeout: 5000 })
    await page.locator(RENAME_INPUT).fill('   ')
    await page.locator(RENAME_INPUT).press('Enter')
    await sleep(150)
    const blank = await page.evaluate(({ note }) => ({
      open: document.querySelector('[data-dsh-widget-board-rename-board]') !== null,
      text: document.querySelector(note)?.textContent ?? '',
      invalid: document.querySelector('[data-dsh-widget-board-rename-input]')?.getAttribute('aria-invalid'),
      disabled: document.querySelector('[data-dsh-widget-board-rename-save]')?.hasAttribute('disabled'),
    }), { note: RENAME_NOTE })
    check('空名字就地报错、保存按钮不可按', blank.open && blank.invalid === 'true' && blank.disabled === true, JSON.stringify(blank))
    check('空名字的说明是给人看的一句话', /不能是空的/.test(blank.text), blank.text)

    // B05：Escape 取消，标签不动。
    await page.keyboard.press('Escape')
    await page.waitForSelector(RENAME, { state: 'detached', timeout: 5000 })
    check('Escape 取消改名，标签还是原来的名字', (await page.locator(`[data-dsh-widget-board-tab="${base}"]`).textContent()) === longName)

    // B05：中文输入法组合期间的回车不保存。
    await openMenu(page, base)
    await page.locator(MENU_RENAME).click()
    await page.waitForSelector(RENAME, { timeout: 5000 })
    await page.locator(RENAME_INPUT).fill('输入法中')
    const composing = await page.evaluate((input) => {
      const node = document.querySelector(input)
      if (node === null) return false
      const event = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'isComposing', { configurable: true, value: true })
      node.dispatchEvent(event)
      return true
    }, RENAME_INPUT)
    await sleep(300)
    check('输入法组合期间的回车不保存', composing && await page.locator(RENAME).count() === 1,
      `弹窗 ${await page.locator(RENAME).count()} 个`)

    // B05：组合结束之后正常回车保存。
    await page.locator(RENAME_INPUT).press('Enter')
    await page.waitForSelector(RENAME, { state: 'detached', timeout: 10000 })
    check('正常回车保存新名字', (await page.locator(`[data-dsh-widget-board-tab="${base}"]`).textContent()) === '输入法中')

    // B06：改名失败保留输入、标签不动。让这一次改名请求在宿主那一侧失败。
    await openMenu(page, base)
    await page.locator(MENU_RENAME).click()
    await page.waitForSelector(RENAME, { timeout: 5000 })
    const failing = '失败也要留住这一行'
    await page.locator(RENAME_INPUT).fill(failing)
    await page.route('**/api/widget-board/boards/*/rename', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '宿主这一轮写不下去了' }) })
    })
    try {
      await page.locator(RENAME_SAVE).click()
      await page.waitForFunction((selector) => /宿主这一轮写不下去了/.test(document.querySelector(selector)?.textContent ?? ''), RENAME, { timeout: 10000 })
      const still = await page.evaluate(({ input }) => ({
        open: document.querySelector('[data-dsh-widget-board-rename-board]') !== null,
        text: document.querySelector(input)?.value ?? '',
        label: document.querySelector('[data-dsh-widget-board-tab]')?.textContent ?? '',
      }), { input: RENAME_INPUT })
      check('改名失败时弹窗留着、输入原样保留', still.open && still.text === failing, JSON.stringify(still))
      check('改名失败时标签还是原来的名字，失败原因写在弹窗里', still.label === '输入法中', still.label)
    } finally {
      await page.unroute('**/api/widget-board/boards/*/rename')
    }
    await page.locator(RENAME_CANCEL).click()
    await page.waitForSelector(RENAME, { state: 'detached', timeout: 5000 })

    // B07：删除确认报出标题、几格、几张卡。
    await openMenu(page, second)
    await page.locator(MENU_REMOVE).click()
    await page.waitForSelector(DELETE, { timeout: 5000 })
    const confirm = await page.evaluate(({ name, cells, cards }) => ({
      title: document.querySelector(name)?.textContent ?? '',
      cells: document.querySelector(cells)?.textContent ?? '',
      cards: document.querySelector(cards)?.textContent ?? '',
      body: document.querySelector('[data-dsh-widget-board-delete-board]')?.textContent ?? '',
    }), { name: DELETE_NAME, cells: DELETE_CELLS, cards: DELETE_CARDS })
    check('删除确认写出看板标题', confirm.title.trim() !== '', confirm.title)
    check('删除确认报出格子数与卡片数', /格/.test(confirm.cells) && /张卡片/.test(confirm.cards), `${confirm.cells} / ${confirm.cards}`)
    check('删除确认说明卡片与保存内容一起删除', /不能撤销/.test(confirm.body), confirm.body.slice(0, 60))
    const deleteFocus = await page.evaluate(() => document.activeElement?.hasAttribute('data-dsh-widget-board-delete-cancel') === true)
    check('删除确认打开时焦点在取消上', deleteFocus === true, String(deleteFocus))
    await page.locator(DELETE_CANCEL).click()
    await page.waitForSelector(DELETE, { state: 'detached', timeout: 5000 })

    // B11：删除失败不丢前端看板。让这一次删除在宿主那一侧失败，确认弹窗留着并写出原因。
    await openMenu(page, base)
    await page.locator(MENU_REMOVE).click()
    await page.waitForSelector(DELETE, { timeout: 5000 })
    await page.route('**/api/widget-board/boards/*/remove', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '宿主这一轮删不掉' }) })
    })
    try {
      await page.locator(DELETE_CONFIRM).click()
      await page.waitForFunction(() => /宿主这一轮删不掉/.test(document.querySelector('[data-dsh-widget-board-delete-board]')?.textContent ?? ''), undefined, { timeout: 10000 })
      const failed = await strip(page)
      check('删除失败时弹窗留着并写出原因', await page.locator(DELETE).count() === 1)
      check('删除失败时看板一个都没少', failed.ids.length === 2 && failed.selected === second, JSON.stringify(failed.ids))
    } finally {
      await page.unroute('**/api/widget-board/boards/*/remove')
    }
    await page.locator(DELETE_CANCEL).click()
    await page.waitForSelector(DELETE, { state: 'detached', timeout: 5000 })

    // B09：删非当前看板不改变活动看板。
    const beforeRemove = await strip(page)
    await openMenu(page, base)
    await page.locator(MENU_REMOVE).click()
    await page.waitForSelector(DELETE, { timeout: 5000 })
    await page.locator(DELETE_CONFIRM).click()
    await page.waitForFunction(({ tabs, count }) => document.querySelectorAll(`${tabs} [data-dsh-widget-board-tab]`).length === count - 1, { tabs: TABS, count: beforeRemove.ids.length }, { timeout: 10000 })
    const afterRemove = await strip(page)
    check('删掉非当前看板之后活动看板不变', afterRemove.selected === second && !afterRemove.ids.includes(base),
      `${String(afterRemove.selected)} / ${JSON.stringify(afterRemove.ids)}`)
    check('删除之后弹窗与菜单都关掉', await closed(page))

    // B08、B10、B11：把剩下的都删掉，最后一块删掉之后补一块空的。
    let guard = 0
    while ((await strip(page)).ids.length > 0 && guard < 8) {
      guard += 1
      const ids = (await strip(page)).ids
      const target = ids[0]
      await openMenu(page, target)
      await page.locator(MENU_REMOVE).click()
      await page.waitForSelector(DELETE, { timeout: 5000 })
      const lastOne = (await strip(page)).ids.length === 1
      if (lastOne) {
        const last = await page.evaluate(() => document.querySelector('[data-dsh-widget-board-delete-board]')?.textContent ?? '')
        check('最后一块的确认里说明会补一块空的', /新的空看板/.test(last), last.slice(0, 80))
      }
      await page.locator(DELETE_CONFIRM).click()
      if (lastOne) {
        // 删最后一块的答复里带的是补上来的那块空看板：等标签换成另一个 id。
        await page.waitForFunction(({ tabs, id }) => {
          const buttons = Array.from(document.querySelectorAll(`${tabs} [data-dsh-widget-board-tab]`))
          return buttons.length === 1 && buttons[0]?.getAttribute('data-dsh-widget-board-tab') !== id
        }, { tabs: TABS, id: target }, { timeout: 15000 })
      } else {
        await page.waitForFunction(({ tabs, count, id }) => {
          const buttons = Array.from(document.querySelectorAll(`${tabs} [data-dsh-widget-board-tab]`))
          return !buttons.some((button) => button.getAttribute('data-dsh-widget-board-tab') === id) && buttons.length === count - 1
        }, { tabs: TABS, count: ids.length, id: target }, { timeout: 15000 })
      }
      await page.waitForSelector(VIEW, { timeout: 5000 })
      const hostActive = await page.evaluate(async () => {
        const workspace = await (await fetch('api/widget-board/boards')).json()
        return { active: workspace.active, ids: workspace.boards.map((board) => board.id) }
      })
      const shown = await strip(page)
      check('删完之后显示的就是宿主选中的那块看板',
        shown.selected === hostActive.active && JSON.stringify(shown.ids) === JSON.stringify(hostActive.ids),
        `${String(shown.selected)} / ${String(hostActive.active)}`)
      if (lastOne) break
    }
    const leftover = await strip(page)
    check('全部删完之后还剩一块空的看板', leftover.ids.length === 1 && leftover.selected === leftover.ids[0], JSON.stringify(leftover.ids))
    const leftoverCards = await page.evaluate(() => document.querySelectorAll('[data-instance]').length)
    check('补上来的这块是空的', leftoverCards === 0, String(leftoverCards))
  } finally {
    // 这一段会删光全部看板（B10 就是要看最后一块删完的样子），之后宿主补一块空的；后面的场景
    // 用不到原来的卡片，这里只把当下的看板数写出来，失败时好对照。
    const ids = (await strip(page)).ids
    if (ids.length !== 1) console.log(`      看板管理这一段结束时还剩 ${String(ids.length)} 块看板`)
  }
}

/**
 * 标签溢出：看板多到标签条放不下时，活动标签被滚进看得见的那一段。
 *
 * @param page - 宿主页面，看板已经打开。
 * @param context - 这一层共用的判定。
 */
async function overflowPass(page, { check }) {
  await page.setViewportSize({ width: 720, height: 800 })
  await sleep(600)
  try {
    for (let index = 0; index < 6; index += 1) {
      const ids = (await strip(page)).ids
      await page.evaluate(async (title) => {
        await fetch('api/widget-board/boards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) })
      }, `溢出的第${String(index + 1)}块看板`)
      await page.waitForFunction(({ tabs, count }) => document.querySelectorAll(`${tabs} [data-dsh-widget-board-tab]`).length > count, { tabs: TABS, count: ids.length }, { timeout: 10000 })
      // 新建的看板是宿主选中的那块：等页面把它挂上，活动标签才在溢出的那一段里。
      await page.waitForFunction(({ tabs, count }) => document.querySelector(`${tabs} [data-dsh-widget-board-tab][aria-selected="true"]`) !== null
        && document.querySelectorAll(`${tabs} [data-dsh-widget-board-tab]`).length > count, { tabs: TABS, count: ids.length }, { timeout: 10000 })
    }
    const state = await page.evaluate(({ tabs, tab }) => {
      const strip = document.querySelector(tabs)
      const active = strip?.querySelector(`${tab}[aria-selected="true"]`)
      const root = document.querySelector('[data-dsh-widget-board-view]')
      const box = (element) => {
        if (element == null) return null
        const rect = element.getBoundingClientRect()
        return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top) }
      }
      return {
        scrollable: strip === null ? false : strip.scrollWidth > strip.clientWidth + 1,
        strip: box(strip), active: box(active), root: box(root),
        overflowX: strip === null ? '' : getComputedStyle(strip).overflowX,
        pageScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }
    }, { tabs: TABS, tab: TAB })
    check('标签太多时标签条自己滚动，页面不横向溢出', state.scrollable === true && state.pageScrollX === false, JSON.stringify(state))
    check('活动标签被滚进看得见的那一段',
      state.active !== null && state.strip !== null && state.active.left >= state.strip.left - 1 && state.active.right <= state.strip.right + 1,
      `${JSON.stringify(state.active)} / ${JSON.stringify(state.strip)}`)
    check('放不下时回到页面顶部', state.strip !== null && state.root !== null && state.strip.top >= state.root.top - 1,
      `${JSON.stringify(state.strip)} / ${JSON.stringify(state.root)}`)
  } finally {
    // 只收掉这一趟新建的看板：原来那一块留给后面的场景。
    const ids = (await strip(page)).ids
    for (const id of ids.slice(1)) {
      await page.evaluate(async (boardId) => {
        await fetch(`api/widget-board/boards/${encodeURIComponent(boardId)}/remove`, { method: 'POST' })
      }, id)
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await sleep(400)
  }
}
/**
 * 减弱动效下菜单与弹窗直接出现，不跑补间。
 *
 * @param page - 按 `reduce` 渲染的宿主页面。
 * @param context - 这一层共用的判定。
 */
async function reducedMotionPass(page, { check }) {
  await page.waitForSelector(TABS, { timeout: 10000 })
  const before = await strip(page)
  const base = before.selected
  check('减弱动效下标签仍有一枚更多按钮', base !== null && await page.locator(MORE).count() >= 1, JSON.stringify(before.ids))
  const open = async (selector) => {
    await page.locator(MORE).first().click()
    await page.waitForSelector(MENU, { timeout: 5000 })
    await page.locator(selector).click()
    await sleep(150)
    return await page.evaluate((target) => {
      const node = document.querySelector(target)
      if (node === null) return null
      const style = getComputedStyle(node)
      return { animation: style.animationName, duration: style.animationDuration, opacity: style.opacity, transform: style.transform }
    }, selector === MENU_REMOVE ? DELETE : RENAME)
  }
  try {
    const rename = await open(MENU_RENAME)
    check('减弱动效下改名弹窗直接就在位', rename !== null && rename.animation === 'none' && rename.opacity === '1' && rename.transform !== 'none',
      JSON.stringify(rename))
    await page.keyboard.press('Escape')
    await page.waitForSelector(RENAME, { state: 'detached', timeout: 5000 })
    const remove = await open(MENU_REMOVE)
    check('减弱动效下删除确认直接就在位', remove !== null && remove.animation === 'none' && remove.opacity === '1', JSON.stringify(remove))
    await page.locator(DELETE_CANCEL).click()
    await page.waitForSelector(DELETE, { state: 'detached', timeout: 5000 })
  } finally {
    const ids = (await strip(page)).ids
    check('减弱动效这一趟没有动看板', JSON.stringify(ids) === JSON.stringify(before.ids), `${JSON.stringify(ids)} / ${JSON.stringify(before.ids)}`)
  }
}

module.exports = { boardManagementPass, overflowPass, reducedMotionPass }
