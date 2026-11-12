/** Sehr kleiner, sicherer Markdown-Renderer (escaped HTML) für KI-Antworten und Lektionen */
export function renderMarkdownLite(md: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const parts = md.split(/```[a-z]*\n?/);
  return parts
    .map((p, i) => {
      if (i % 2) return `<pre class="code-diff"><code>${esc(p.replace(/\n$/, ''))}</code></pre>`;
      return esc(p)
        .replace(/^### (.*)$/gm, '<h4>$1</h4>')
        .replace(/^## (.*)$/gm, '<h3>$1</h3>')
        .replace(/^# (.*)$/gm, '<h3>$1</h3>')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^[-*] (.*)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
        .replace(/\n{2,}/g, '<br/><br/>')
        .replace(/\n/g, ' ');
    })
    .join('');
}
