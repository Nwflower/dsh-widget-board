/*
 * Markdown/代码卡：marked 排版、highlight.js 高亮，两个库都由宿主内联（D7）。
 *
 * 原始 HTML 一律转成文本，链接只放行 http(s)、mailto 与页内锚点，图片只认 data: 与 blob:：
 * 组件文档的 CSP 已经限制得很紧，这里再把 Markdown 自己写出来的出口收窄一次。
 */
(function () {
  var card = document.querySelector('.md-card')
  if (!card) return

  var widget = window.widget
  var parser = window.marked
  var highlighter = window.hljs
  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    body: card.querySelector('[data-role="body"]'),
    empty: card.querySelector('[data-role="empty"]')
  }

  /** 认识的代码语言：标记里写简称时换成 highlight.js 的名字。 */
  var ALIAS = { js: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash', html: 'xml', py: 'python' }

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function sample() {
    if (isZh()) {
      return [
        '## 发布前检查',
        '',
        '这一页要能在一眼内读完。先删掉不回答任何问题的卡片。',
        '',
        '- 尺寸矩阵在 1×6 到 4×30 都通过',
        '- 浅色与深色都核对过',
        '- 空态、加载与错误都能看见',
        '',
        '| 项目 | 状态 |',
        '| --- | --- |',
        '| 组件 | 已就绪 |',
        '| 文档 | 已更新 |',
        '',
        '```ts',
        'const size = widget.size',
        'if (size !== null) {',
        '  console.log(size.w, size.h)',
        '}',
        '```',
        '',
        '> 改动一次只做一件事，方便回头核对。'
      ].join('\n')
    }
    return [
      '## Pre-ship check',
      '',
      'The page should read in one pass. Delete any card that answers no question.',
      '',
      '- Size matrix passes from 1×6 to 4×30',
      '- Light and dark checked',
      '- Empty, loading and error states are visible',
      '',
      '| Item | State |',
      '| --- | --- |',
      '| Components | Ready |',
      '| Docs | Updated |',
      '',
      '```ts',
      'const size = widget.size',
      'if (size !== null) {',
      '  console.log(size.w, size.h)',
      '}',
      '```',
      '',
      '> One change at a time, so it is easy to check afterwards.'
    ].join('\n')
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      if (character === '&') return '&amp;'
      if (character === '<') return '&lt;'
      if (character === '>') return '&gt;'
      if (character === '"') return '&quot;'
      return '&#39;'
    })
  }

  function safeHref(href) {
    var value = String(href || '').trim()
    return /^(https?:|mailto:|#)/i.test(value) ? value : null
  }

  function highlight(text, rawLanguage) {
    var language = ALIAS[rawLanguage] || rawLanguage
    if (highlighter !== undefined && language !== '' && highlighter.getLanguage(language) !== undefined) {
      return highlighter.highlight(text, { language: language }).value
    }
    return escapeHtml(text)
  }

  if (parser !== undefined) {
    parser.use({
      gfm: true,
      renderer: {
        code: function (token) {
          var rawLanguage = String(token.lang || '').trim().split(/\s+/)[0]
          var label = rawLanguage === '' ? 'text' : rawLanguage
          return '<div class="md-code"><div class="md-code__bar"><span>' + escapeHtml(label) + '</span></div><pre><code class="hljs">' + highlight(token.text, rawLanguage) + '</code></pre></div>'
        },
        html: function (token) {
          return escapeHtml(token.text)
        },
        link: function (token) {
          var href = safeHref(token.href)
          var inner = this !== undefined && this.parser !== undefined ? this.parser.parseInline(token.tokens || []) : escapeHtml(token.text)
          if (href === null) return inner
          var title = token.title === null || token.title === undefined ? '' : ' title="' + escapeHtml(token.title) + '"'
          return '<a href="' + escapeHtml(href) + '"' + title + ' target="_blank" rel="noreferrer noopener">' + inner + '</a>'
        },
        image: function (token) {
          var href = String(token.href || '').trim()
          var allowed = /^(data:|blob:)/i.test(href)
          if (!allowed) return '<span class="md-image-alt">' + escapeHtml(token.text || 'image') + '</span>'
          var title = token.title === null || token.title === undefined ? '' : ' title="' + escapeHtml(token.title) + '"'
          return '<img src="' + escapeHtml(href) + '" alt="' + escapeHtml(token.text || '') + '"' + title + ' loading="lazy">'
        }
      }
    })
  }

  function write(node, value) {
    if (node !== undefined && node !== null) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function emptyLabel() {
    if (widget === undefined) return isZh() ? '还没有内容' : 'Nothing here yet'
    var label = widget.t('empty')
    return label === 'empty' ? (isZh() ? '还没有内容' : 'Nothing here yet') : label
  }

  function applyProps(source) {
    var base = { title: isZh() ? '笔记' : 'Notes' }
    var props = source !== null && typeof source === 'object' ? source : {}
    write(el.kicker, typeof props.kicker === 'string' ? props.kicker : '')
    write(el.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : base.title)
  }

  function render(markdown) {
    if (parser === undefined) {
      el.body.textContent = markdown
      return
    }
    var html = parser.parse(markdown, { async: false })
    el.body.innerHTML = typeof html === 'string' ? html : escapeHtml(markdown)
  }

  function applyData(source) {
    var data = source !== null && typeof source === 'object' ? source : {}
    var markdown = typeof data.markdown === 'string' ? data.markdown : sample()
    var blank = markdown.trim() === ''
    el.empty.textContent = emptyLabel()
    el.body.hidden = blank
    el.empty.hidden = !blank
    if (blank) {
      el.body.innerHTML = ''
    } else {
      render(markdown)
    }
    applyProps(widget === undefined ? {} : widget.props)
  }

  applyProps(widget === undefined ? {} : widget.props)
  applyData(widget === undefined ? null : widget.data)
  if (widget !== undefined) {
    widget.onProps(function (props) {
      applyProps(props)
      applyData(widget.data)
    })
    widget.onData(applyData)
  }
})()
