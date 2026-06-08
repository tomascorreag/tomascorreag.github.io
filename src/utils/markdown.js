const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v']);

const HEADING_RE = /^##\s+(.+)$/;
const DIVIDER_RE = /^-{3,}$/;
const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const LINK_LINE_RE = /^\[([^\]]+)\]\(([^)]+)\)$/;
const CAPTION_RE = /^\*([^*]+)\*$/;

function isVideoPath(src) {
  const ext = src.split('.').pop().toLowerCase();
  return VIDEO_EXTS.has(ext);
}

export function applyInline(text) {
  const tmp = document.createElement('span');
  tmp.textContent = text;
  let html = tmp.innerHTML;
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  return html;
}

export function parseMarkdown(mdString, { createMediaElement, iconMap }) {
  const fragment = document.createDocumentFragment();
  const lines = mdString.split('\n');

  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  let paraLines = [];
  let i = 0;

  function flushParagraph() {
    if (!paraLines.length) return;
    const p = document.createElement('p');
    p.className = 'article-text article-reveal';
    p.innerHTML = applyInline(paraLines.join(' '));
    fragment.appendChild(p);
    paraLines = [];
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) {
      flushParagraph();
      i++;
      continue;
    }

    let match = line.match(HEADING_RE);
    if (match) {
      flushParagraph();
      const h3 = document.createElement('h3');
      h3.className = 'article-heading article-reveal';
      h3.innerHTML = applyInline(match[1]);
      fragment.appendChild(h3);
      i++;
      continue;
    }

    if (DIVIDER_RE.test(line)) {
      flushParagraph();
      const hr = document.createElement('hr');
      hr.className = 'article-divider';
      fragment.appendChild(hr);
      i++;
      continue;
    }

    match = line.match(IMAGE_RE);
    if (match) {
      flushParagraph();
      const [, alt, src] = match;
      const figure = document.createElement('figure');
      figure.className = 'article-figure article-reveal';

      const className = isVideoPath(src) ? 'article-block-video' : 'article-block-image';
      const media = createMediaElement(src, { alt, className });
      if (media) figure.appendChild(media);

      if (i + 1 < lines.length) {
        const capMatch = lines[i + 1].trim().match(CAPTION_RE);
        if (capMatch) {
          const cap = document.createElement('figcaption');
          cap.textContent = `> ${capMatch[1]}`;
          figure.appendChild(cap);
          i++;
        }
      }

      fragment.appendChild(figure);
      i++;
      continue;
    }

    match = line.match(LINK_LINE_RE);
    if (match) {
      flushParagraph();
      const div = document.createElement('div');
      div.className = 'article-links article-reveal';

      while (i < lines.length) {
        const linkMatch = lines[i].trim().match(LINK_LINE_RE);
        if (!linkMatch) break;

        const [, labelPart, url] = linkMatch;
        const pipeIdx = labelPart.indexOf('|');
        const label = pipeIdx >= 0 ? labelPart.slice(0, pipeIdx) : labelPart;
        const iconKey = pipeIdx >= 0 ? labelPart.slice(pipeIdx + 1) : 'website';

        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'article-link';
        const icon = iconMap[iconKey] ?? iconMap.website;
        a.innerHTML = `${icon}<span>${label}</span>`;
        div.appendChild(a);
        i++;
      }

      fragment.appendChild(div);
      continue;
    }

    if (line.startsWith('- ')) {
      flushParagraph();
      const ul = document.createElement('ul');
      ul.className = 'article-list article-reveal';
      while (i < lines.length && lines[i].trim().startsWith('- ')) {
        const li = document.createElement('li');
        li.innerHTML = applyInline(lines[i].trim().slice(2));
        ul.appendChild(li);
        i++;
      }
      fragment.appendChild(ul);
      continue;
    }

    paraLines.push(line);
    i++;
  }

  flushParagraph();
  return fragment;
}
