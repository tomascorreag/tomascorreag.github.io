const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v']);

const HEADING_RE = /^##\s+(.+)$/;
const DIVIDER_RE = /^-{3,}$/;
const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)(?:\{(left|right|center)\})?$/;
const LINK_LINE_RE = /^\[([^\]]+)\]\(([^)]+)\)$/;
const CAPTION_RE = /^\*([^*]+)\*$/;

function isVideoPath(src) {
  const ext = src.split('.').pop().toLowerCase();
  return VIDEO_EXTS.has(ext);
}

// Bare URL / domain matcher. Two alternatives: a full http(s) URL, or a bare
// domain whose final label is a whitelisted TLD (so "README.md" / "Three.js"
// don't get linked). The leading (?<![@/\w]) lookbehind skips emails (@) and
// pieces of an already-matched URL (/), and avoids latching onto a word.
const BARE_TLDS = 'com|org|net|io|art|gg|dev|co|edu|gov|app|games';
const URL_RE = new RegExp(
  String.raw`(?<![@/\w])((?:https?:\/\/)[^\s<]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:${BARE_TLDS})(?:\/[^\s<]*)?)`,
  'gi',
);

// Linkify bare URLs in the gaps between existing <a>…</a> tags. Splitting on
// the anchor tag (captured group → kept in the array at odd indices) means we
// never touch URLs that the explicit [label](url) syntax already linked.
function autolinkBareUrls(html) {
  return html
    .split(/(<a\b[^>]*>.*?<\/a>)/gis)
    .map((seg, i) => {
      if (i % 2 === 1) return seg; // an <a>…</a> segment — leave untouched
      return seg.replace(URL_RE, (m) => {
        const href = /^https?:\/\//i.test(m) ? m : `https://${m}`;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${m}</a>`;
      });
    })
    .join('');
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
  html = autolinkBareUrls(html);
  return html;
}

export function parseMarkdown(mdString, { createMediaElement, iconMap }) {
  const fragment = document.createDocumentFragment();
  const lines = mdString.split('\n');

  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  let paraLines = [];
  let i = 0;

  // Where new blocks land. Normally `fragment` (a flex column). When a
  // left/right image opens a float group, this points at that group's <div>
  // (a block-flow BFC) so following content (paragraphs, headings, lists)
  // wraps the float. A `---` divider, another image, or a link row clears the
  // float via closeFloatGroup() and resets it back to `fragment`.
  let container = fragment;

  function closeFloatGroup() {
    container = fragment;
  }

  function flushParagraph() {
    if (!paraLines.length) return;
    const p = document.createElement('p');
    p.className = 'article-text article-reveal';
    p.innerHTML = applyInline(paraLines.join(' '));
    container.appendChild(p);
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
      container.appendChild(h3);
      i++;
      continue;
    }

    if (DIVIDER_RE.test(line)) {
      flushParagraph();
      closeFloatGroup();
      const hr = document.createElement('hr');
      hr.className = 'article-divider';
      container.appendChild(hr);
      i++;
      continue;
    }

    match = line.match(IMAGE_RE);
    if (match) {
      flushParagraph();
      // A new image always ends any prior float group: a center image must not
      // land inside one, and a left/right image starts a fresh group below.
      closeFloatGroup();
      const [, alt, src, align = 'center'] = match;

      // Side-by-side row: 2+ CONSECUTIVE center image lines (no blank line and
      // no caption between them) lay out next to each other. Floated (left/right)
      // images are never grouped — they keep their text-wrap behaviour.
      if (align === 'center') {
        const run = [match];
        let j = i + 1;
        while (j < lines.length) {
          const t = lines[j].trim();
          if (t === '') break; // a blank line ends the run
          const m = t.match(IMAGE_RE);
          if (!m || (m[3] && m[3] !== 'center')) break;
          run.push(m);
          j++;
        }
        if (run.length >= 2) {
          const row = document.createElement('div');
          row.className = 'article-figure-row article-reveal';
          for (const rm of run) {
            const fig = document.createElement('figure');
            fig.className = 'article-figure';
            const cls = isVideoPath(rm[2]) ? 'article-block-video' : 'article-block-image';
            const m = createMediaElement(rm[2], { alt: rm[1], className: cls });
            if (m) fig.appendChild(m);
            row.appendChild(fig);
          }
          container.appendChild(row);
          i = j;
          // An optional caption line applies to the whole row.
          const capMatch = i < lines.length && lines[i].trim().match(CAPTION_RE);
          if (capMatch) {
            const cap = document.createElement('p');
            cap.className = 'article-row-caption';
            cap.textContent = `> ${capMatch[1]}`;
            container.appendChild(cap);
            i++;
          }
          continue;
        }
      }

      const figure = document.createElement('figure');
      figure.className = 'article-figure article-reveal';
      if (align === 'left' || align === 'right') {
        figure.classList.add(`article-figure--${align}`);
      }

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

      if (align === 'left' || align === 'right') {
        // Wrap the float + following text in a BFC div so paragraphs wrap the
        // image. Append the group now (order preserved), then redirect.
        const group = document.createElement('div');
        group.className = 'article-float-group';
        group.appendChild(figure);
        fragment.appendChild(group);
        container = group;
      } else {
        container.appendChild(figure);
      }
      i++;
      continue;
    }

    match = line.match(LINK_LINE_RE);
    if (match) {
      flushParagraph();
      closeFloatGroup();
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

      container.appendChild(div);
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
      container.appendChild(ul);
      continue;
    }

    paraLines.push(line);
    i++;
  }

  flushParagraph();
  closeFloatGroup();
  return fragment;
}
