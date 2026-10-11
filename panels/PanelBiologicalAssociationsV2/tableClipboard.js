// Tabs/newlines separate Excel cells/rows; embedded whitespace stays in its cell.
const cellText = value => String(value).replace(/[\t\r\n]+/g, ' ').trim()
const escapeHtml = value => cellText(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char])

export function tableClipboardData(cells) {
  return {
    text: cells.map(row => row.map(cellText).join('\t')).join('\n'),
    html: '<table>' + cells.map(row => '<tr>' + row.map(cell =>
      `<td>${escapeHtml(cell)}</td>`).join('') + '</tr>').join('') + '</table>'
  }
}

/** Copy whole selected cells when icons are involved. Other text selections
 * retain the browser's normal behavior. Only the current table is handled.
 */
export function copyTableSelection(event, root) {
  if (event.defaultPrevented || !root) return
  const selection = root.ownerDocument.getSelection()
  if (!event.clipboardData || selection?.rangeCount !== 1 || selection.isCollapsed) return
  const table = root.querySelector('table')
  const range = selection.getRangeAt(0)
  if (!table?.contains(range.startContainer) || !table.contains(range.endContainer)) return
  if (![...table.querySelectorAll('[data-copy-text], [data-copy-ignore]')].some(node => range.intersectsNode(node))) return

  const cells = [...table.rows].map(row => [...row.cells]
    .filter(cell => range.intersectsNode(cell))
    .map(cell => {
      const copy = cell.cloneNode(true)
      copy.querySelectorAll('[data-copy-text]').forEach(node => {
        node.replaceWith(node.getAttribute('data-copy-text'))
      })
      copy.querySelectorAll('[data-copy-ignore]').forEach(node => node.remove())
      return cellText(copy.textContent)
    })).filter(row => row.length)
  const { text, html } = tableClipboardData(cells)
  event.clipboardData.setData('text/plain', text)
  event.clipboardData.setData('text/html', html)
  event.preventDefault()
}
