(() => {
  const CLASS = 'ig-minimal-download';
  const LIKE = 'M16.792 3.904A4.989 4.989 0 0 1 21.5 9.122c0 3.072-2.652 4.959-5.197 7.222-2.512 2.243-3.865 3.469-4.303 3.752-.477-.309-2.143-1.823-4.303-3.752C5.141 14.072 2.5 12.167 2.5 9.122a4.989 4.989 0 0 1 4.708-5.218 4.21 4.21 0 0 1 3.675 1.941c.84 1.175.98 1.763 1.12 1.763s.278-.588 1.11-1.766a4.17 4.17 0 0 1 3.679-1.938m0-2a6.04 6.04 0 0 0-4.797 2.127 6.052 6.052 0 0 0-4.787-2.127A6.985 6.985 0 0 0 .5 9.122c0 3.61 2.55 5.827 5.015 7.97.283.246.569.494.853.747l1.027.918a44.998 44.998 0 0 0 3.518 3.018 2 2 0 0 0 2.174 0 45.263 45.263 0 0 0 3.626-3.115l.922-.824c.293-.26.59-.519.885-.774 2.334-2.025 4.98-4.32 4.98-7.94a6.985 6.985 0 0 0-6.708-7.218Z';
  const ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M19 9h-4V3H9v6H5l7 7 7-7Zm-14 9v2h14v-2H5Z"/></svg>';
  const mediaIdCache = new Map();
  const mediaInfoCache = new Map();

  const parentAt = (node, levels) => {
    let result = node;
    while (levels-- && result) result = result.parentElement;
    return result;
  };

  function unlockImageMenus() {
    document.querySelectorAll('article img, main img').forEach((image) => {
      const rect = image.getBoundingClientRect();
      // Leave avatars and small interface icons alone; expose actual media only.
      if (rect.width < 180 || rect.height < 180) return;
      image.dataset.igNativeMenu = 'true';
      image.style.zIndex = '999';
      image.style.pointerEvents = 'auto';
    });
  }

  // Instagram attaches handlers that suppress the browser menu. Stopping that
  // propagation does not prevent the browser's own image context menu.
  document.addEventListener('contextmenu', (event) => {
    const image = event.target instanceof Element ? event.target.closest('img[data-ig-native-menu="true"]') : null;
    if (image) event.stopImmediatePropagation();
  }, true);

  function findAppId() {
    for (const script of document.querySelectorAll('body > script')) {
      const match = script.textContent?.match(/"X-IG-App-ID":"(\d+)"/);
      if (match) return match[1];
    }
    return null;
  }

  function shortcodeFrom(article) {
    const pageMatch = location.pathname.match(/\/(?:p|reel|reels)\/([^/]+)/);
    if (pageMatch) return { code: pageMatch[1], route: location.pathname.includes('/p/') ? 'p' : 'reel' };
    for (const link of article?.querySelectorAll?.('a[href]') || []) {
      const match = link.getAttribute('href')?.match(/^\/(p|reel)\/([^/]+)/);
      if (match) return { code: match[2], route: match[1] };
    }
    return null;
  }

  // Instagram shortcodes are base64url-encoded numeric media IDs. This avoids
  // relying solely on the HTML marker that Instagram frequently changes.
  function mediaIdFromShortcode(shortcode) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let id = 0n;
    for (const character of shortcode) {
      const value = alphabet.indexOf(character);
      if (value < 0) return null;
      id = id * 64n + BigInt(value);
    }
    return id.toString();
  }

  async function findMediaId(code, route) {
    const key = `${route}:${code}`;
    if (!mediaIdCache.has(key)) {
      const postUrl = `https://www.instagram.com/${route}/${code}/`;
      const response = await fetch(postUrl);
      const html = await response.text();
      const match = html.match(/instagram:\/\/media\?id=(\d+)|["' ]media_id["' ]:["' ](\d+)/);
      const mediaId = match?.[1] || match?.[2] || mediaIdFromShortcode(code);
      if (!mediaId) return null;
      mediaIdCache.set(key, mediaId);
    }
    return mediaIdCache.get(key);
  }

  async function mediaInfo(id) {
    if (mediaInfoCache.has(id)) return mediaInfoCache.get(id);
    const appId = findAppId();
    if (!appId) throw new Error('Could not find Instagram app id');
    const apiUrl = `https://i.instagram.com/api/v1/media/${id}/info/`;
    const headers = { Accept: '*/*', 'X-IG-App-ID': appId };
    let payload;
    // A content script has host permissions, while a userscript does not.
    // Let Tampermonkey make this cross-origin API request when it is available.
    if (typeof GM_xmlhttpRequest === 'function') {
      payload = await new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: apiUrl,
          headers,
          onload: (result) => {
            if (result.status < 200 || result.status >= 300) {
              reject(new Error(`Instagram API: ${result.status}`));
              return;
            }
            try { resolve(JSON.parse(result.responseText)); } catch (_) { reject(new Error('Invalid Instagram API response')); }
          },
          onerror: () => reject(new Error('Instagram API request failed')),
          ontimeout: () => reject(new Error('Instagram API request timed out')),
        });
      });
    } else {
      const response = await fetch(apiUrl, { credentials: 'include', headers });
      if (!response.ok) throw new Error(`Instagram API: ${response.status}`);
      payload = await response.json();
    }
    const item = payload.items?.[0];
    if (!item) throw new Error('Instagram returned no media');
    mediaInfoCache.set(id, item);
    return item;
  }

  function largestCandidate(candidates) {
    return (candidates || []).reduce((best, candidate) => {
      const bestSize = (best?.width || 0) * (best?.height || 0);
      const size = (candidate.width || 0) * (candidate.height || 0);
      return size > bestSize ? candidate : best;
    }, null);
  }

  function filenameFromUrl(url) {
    try {
      const name = new URL(url).pathname.split('/').pop();
      return name ? decodeURIComponent(name) : '';
    } catch (_) {
      return '';
    }
  }

  function toDownload(item, parent, renderedUrl = '') {
    const video = largestCandidate(item.video_versions);
    const image = largestCandidate(item.image_versions2?.candidates);
    const source = video || image;
    if (!source?.url) throw new Error('No downloadable media URL');
    const id = item.id || item.pk || parent?.id || parent?.pk || 'instagram_media';
    return {
      url: source.url,
      type: video ? 'video' : 'image',
      username: item.owner?.username || parent?.owner?.username || parent?.user?.username || 'instagram',
      id,
      // Match the original extension: its video/reel/story filename is the
      // basename of the resolved video_versions URL, not the media ID.
      sourceName: video ? filenameFromUrl(source.url) : filenameFromUrl(renderedUrl) || filenameFromUrl(source.url),
    };
  }

  function urlPath(url) {
    try { return new URL(url).pathname; } catch (_) { return ''; }
  }

  function visibleMediaSources(article) {
    const scope = article && typeof article.querySelectorAll === 'function' ? article : document;
    const articleRect = typeof scope.getBoundingClientRect === 'function'
      ? scope.getBoundingClientRect()
      : { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
    const media = [];
    scope.querySelectorAll('img, video').forEach((element) => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(0, Math.min(rect.right, articleRect.right) - Math.max(rect.left, articleRect.left));
      const height = Math.max(0, Math.min(rect.bottom, articleRect.bottom) - Math.max(rect.top, articleRect.top));
      const area = width * height;
      if (!area) return;
      // IG serves feed videos through a blob: currentSrc. Its poster remains a
      // real CDN URL and identifies the corresponding carousel_media item.
      const urls = element instanceof HTMLVideoElement
        ? [element.poster, element.currentSrc, element.src]
        : [element.currentSrc, element.src];
      media.push({ area, urls: urls.filter((url) => url && !url.startsWith('blob:')) });
    });
    return media.sort((left, right) => right.area - left.area);
  }

  function visibleMediaUrl(article) {
    return visibleMediaSources(article)[0]?.urls[0] || '';
  }

  function carouselIndexFromGeometry(article) {
    if (!(article instanceof Element)) return -1;
    const articleRect = article.getBoundingClientRect();
    const centerX = articleRect.left + articleRect.width / 2;
    // Instagram's feed keeps adjacent slides mounted. Their <li> transforms
    // move only the active slide to the article centre, independent of media
    // type or whether a video source is a blob URL.
    const slides = [...article.querySelectorAll('li[style]')]
      .filter((slide) => slide.querySelector('img, video'));
    let activeIndex = -1;
    let bestDistance = Infinity;
    slides.forEach((slide, index) => {
      const rect = slide.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom <= articleRect.top || rect.top >= articleRect.bottom) return;
      const distance = Math.abs(rect.left + rect.width / 2 - centerX);
      if (distance < bestDistance) {
        bestDistance = distance;
        activeIndex = index;
      }
    });
    return activeIndex;
  }

  function carouselIndexFromIndicator(article, total) {
    if (!(article instanceof Element)) return -1;
    // Feed carousel dots are real buttons now. The active one carries this
    // stable accessibility state even while IG keeps neighbouring slides in
    // the DOM with misleading transforms or preloaded media.
    const active = article.querySelector('button[aria-current="step"][aria-label]');
    const number = active?.getAttribute('aria-label')?.match(/(\d+)(?!.*\d)/)?.[1];
    const index = number ? Number(number) - 1 : -1;
    return Number.isInteger(index) && index >= 0 && index < total ? index : -1;
  }

  function carouselIndex(article, parent) {
    const value = new URLSearchParams(location.search).get('img_index');
    if (value) return Math.max(0, Number(value) - 1);
    if (!(article instanceof Element)) return 0;

    const indicatorIndex = carouselIndexFromIndicator(article, parent?.carousel_media?.length || 0);
    if (indicatorIndex >= 0) return indicatorIndex;

    // Fallback for layouts without semantic carousel indicators.
    const geometryIndex = carouselIndexFromGeometry(article);
    if (geometryIndex >= 0) return geometryIndex;

    // Fallback for layouts without carousel <li> slides.
    const visibleSources = visibleMediaSources(article);
    if (visibleSources.length && parent?.carousel_media) {
      // Match each rendered source in area order. This handles a video slide
      // whose playable source is a blob while its poster is an API thumbnail.
      for (const rendered of visibleSources) {
        const match = parent.carousel_media.findIndex((item) => {
        const candidates = [...(item.image_versions2?.candidates || []), ...(item.video_versions || [])];
          return candidates.some((candidate) => rendered.urls.some((url) => {
            const path = urlPath(url);
            return path && (urlPath(candidate.url) === path || filenameFromUrl(candidate.url) === filenameFromUrl(url));
          }));
        });
        if (match >= 0) return match;
      }
    }

    // Exact carousel-dot routing used by the working original extension.
    const isPostView = location.pathname.startsWith('/p/');
    let dots = [];
    if (isPostView) {
      dots = [...article.querySelectorAll(':scope > div > div > div > div:nth-child(2) > div')];
    } else if (/Mobi|Android|iPhone/i.test(navigator.userAgent)) {
      dots = [...article.querySelectorAll(':scope > div > div:nth-child(2) > div > div > div > div > div > div:nth-child(2) > div')];
    } else {
      const nodes = article.querySelector('ul')?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement?.nextElementSibling?.childNodes;
      dots = nodes ? [...nodes].filter((node) => node instanceof HTMLElement) : [];
    }
    const activeDot = dots.findIndex((dot) => dot instanceof HTMLElement && dot.classList.length === 2);
    if (activeDot >= 0) return activeDot;

    // IG sometimes hides its dots. In that case the slide whose rendered media
    // is closest to the horizontal centre of this article is the active one.
    const slides = [...article.querySelectorAll('li[style][class]')];
    const articleRect = article.getBoundingClientRect();
    const centerX = articleRect.left + articleRect.width / 2;
    let bestIndex = -1;
    let bestDistance = Infinity;
    slides.forEach((slide, index) => {
      const media = slide.querySelector('img, video');
      const rect = media?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0 || rect.bottom <= articleRect.top || rect.top >= articleRect.bottom) return;
      const distance = Math.abs(rect.left + rect.width / 2 - centerX);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex >= 0 ? bestIndex : 0;
  }

  async function resolvePostOrReel(article) {
    const short = shortcodeFrom(article);
    if (!short) throw new Error('Could not resolve post or reel code');
    const id = await findMediaId(short.code, short.route);
    if (!id) throw new Error('Could not resolve Instagram media id');
    const parent = await mediaInfo(id);
    const item = parent.carousel_media ? parent.carousel_media[carouselIndex(article, parent)] || parent.carousel_media[0] : parent;
    return toDownload(item, parent, visibleMediaUrl(article));
  }

  function currentStoryElement() {
    return document.querySelector('section video') || document.querySelector('section img[decoding="sync"]') || document.querySelector('section img');
  }

  async function resolveStory() {
    const parts = location.pathname.split('/').filter(Boolean);
    const username = parts[1] || 'instagram';
    const storyId = parts[2];
    if (storyId && /^\d+$/.test(storyId)) {
      try { return toDownload(await mediaInfo(storyId), null, currentStoryElement()?.currentSrc || currentStoryElement()?.src); } catch (_) { /* DOM fallback below */ }
    }
    const element = currentStoryElement();
    const url = element?.currentSrc || element?.src;
    if (!url) throw new Error('Could not find current story media');
    const type = element instanceof HTMLVideoElement ? 'video' : 'image';
    const sourceName = filenameFromUrl(url);
    return { url, type, username, id: storyId || sourceName || 'story', sourceName };
  }

  function makeFilename(media) {
    const username = String(media.username).replace(/[\\/:*?"<>|]/g, '_');
    let sourceName = String(media.sourceName || filenameFromUrl(media.url) || media.id).replace(/[\\/:*?"<>|]/g, '_');
    if (!/\.[a-z0-9]{2,5}$/i.test(sourceName)) sourceName += media.type === 'video' ? '.mp4' : '.jpg';
    return `${username}_${sourceName}`;
  }

  async function save(media) {
    const name = makeFilename(media);
    // GM_download bypasses page-level CORS restrictions for Instagram's CDN.
    if (typeof GM_download === 'function') {
      await new Promise((resolve, reject) => {
        GM_download({
          url: media.url,
          name,
          saveAs: false,
          onload: resolve,
          onerror: (result) => reject(new Error(`Media download: ${result.error || 'failed'}`)),
          ontimeout: () => reject(new Error('Media download timed out')),
        });
      });
      return;
    }
    const response = await fetch(media.url, { headers: new Headers({ Origin: location.origin }), mode: 'cors' });
    if (!response.ok) throw new Error(`Media request: ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  async function download(kind, article, button) {
    const media = kind === 'story' ? await resolveStory() : await resolvePostOrReel(article);
    await save(media);
  }

  function setButtonState(button, state) {
    const colors = { idle: !isFeedPage() || button.dataset.hotkeyTarget === 'true' ? '#0095f6' : '#fff', loading: '#f59e0b', done: '#22a06b', failed: '#ed4956' };
    button.style.backgroundColor = 'transparent';
    button.style.color = colors[state];
    button.style.transform = state === 'loading' ? 'scale(.92)' : 'scale(1)';
    button.title = state === 'loading' ? 'Downloading…' : state === 'done' ? 'Downloaded' : state === 'failed' ? 'Download failed' : `Download ${button.dataset.kind}`;
  }

  async function startDownload(button) {
    if (!button || button.dataset.busy) return;
    button.dataset.busy = '1';
    setButtonState(button, 'loading');
    try {
      // Do not retain a custom DOM object on the button: Tampermonkey crosses
      // an isolated-world boundary for such properties. Resolve it at click time.
      const article = button.closest('article') || document.querySelector('article') || document;
      await download(button.dataset.kind, article, button);
      setButtonState(button, 'done');
    } catch (error) {
      setButtonState(button, 'failed');
      button.title = `Download failed: ${error.message}`;
      console.error('[IG downloader]', error);
    } finally {
      button.dataset.busy = '';
      setTimeout(() => setButtonState(button, 'idle'), 1800);
    }
  }

  function nearestVisibleButton() {
    const viewportCenter = window.innerHeight / 2;
    const candidates = [...document.querySelectorAll(`.${CLASS}`)].filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
    });
    candidates.sort((left, right) => {
      const leftCenter = left.getBoundingClientRect().top + left.getBoundingClientRect().height / 2;
      const rightCenter = right.getBoundingClientRect().top + right.getBoundingClientRect().height / 2;
      return Math.abs(leftCenter - viewportCenter) - Math.abs(rightCenter - viewportCenter);
    });
    return candidates[0] || null;
  }

  function isFeedPage() {
    return location.pathname === '/' || location.pathname === '/feed/';
  }

  function refreshHotkeyIndicator() {
    if (!isFeedPage()) return;
    const target = nearestVisibleButton();
    document.querySelectorAll(`.${CLASS}`).forEach((button) => {
      const isTarget = button === target;
      button.dataset.hotkeyTarget = String(isTarget);
      if (!button.dataset.busy) button.style.color = isTarget ? '#0095f6' : '#fff';
    });
  }

  function isTypingTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  }

  // A/D carousel navigation. This keeps the supplied userscript's selection
  // rules isolated from the downloader so it cannot affect media resolution.
  function isVisibleCarouselControl(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
      && rect.top < window.innerHeight && rect.left < window.innerWidth
      && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function carouselControlScore(element, side) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.width < 20 || rect.height < 20 || rect.width > 120 || rect.height > 120) return Infinity;
    if (y < vh * 0.15 || y > vh * 0.85) return Infinity;
    if (side === 'right' && (x <= vw / 2 || x > vw - 20)) return Infinity;
    if (side === 'left' && (x >= vw / 2 || x < 80)) return Infinity;
    const horizontalTarget = side === 'left' ? vw * 0.30 : vw * 0.70;
    return Math.abs(y - vh / 2) + Math.abs(x - horizontalTarget) * 0.15;
  }

  function pickCarouselControl(candidates, side) {
    return candidates
      .filter(isVisibleCarouselControl)
      .map((element) => ({ element, score: carouselControlScore(element, side) }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((left, right) => left.score - right.score)[0]?.element || null;
  }

  function clickCarouselControl(side) {
    const isNext = side === 'right';
    const semanticSelector = isNext
      ? 'button[aria-label="Next"]'
      : 'button[aria-label="Previous"], button[aria-label="Prev"]';
    let button = pickCarouselControl([...document.querySelectorAll(semanticSelector)], side);
    if (!button) {
      const label = isNext ? 'next' : 'previous';
      const candidates = [...document.querySelectorAll('button')].filter((element) => {
        const aria = (element.getAttribute('aria-label') || '').toLowerCase();
        const title = (element.getAttribute('title') || '').toLowerCase();
        if (isNext) return aria.includes(label) || title.includes(label);
        return !(aria.includes('next') || title.includes('next'));
      });
      button = pickCarouselControl(candidates, side);
    }
    if (!button && !isNext) button = document.querySelector('button._afxv._al46._al47');
    if (!button) return false;
    button.click();
    return true;
  }

  function interceptCarouselHotkeys(event) {
    if (event.ctrlKey || event.altKey || event.metaKey || event.repeat || isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    const side = key === 'a' ? 'left' : key === 'd' ? 'right' : null;
    if (!side || !clickCarouselControl(side)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function addButton(container, kind, article) {
    if (!(container instanceof HTMLElement) || container.querySelector(`.${CLASS}[data-kind="${kind}"]`)) return;
    const button = document.createElement('a');
    button.className = CLASS;
    button.dataset.kind = kind;
    button.innerHTML = ICON;
    button.title = `Download ${kind}`;
    button.setAttribute('style', 'cursor:pointer;padding:7px;color:#0095f6;background:transparent;border-radius:8px;position:relative;display:inline-flex;z-index:999;line-height:0;transition:color .18s ease,transform .18s ease');
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await startDownload(button);
    });
    container.append(button);
  }

  function scanPosts() {
    document.querySelectorAll('article').forEach((article) => {
      const like = article.querySelector(`path[d="${LIKE}"]`);
      if (like) addButton(parentAt(like, 7), 'post', article);
    });
    if (location.pathname.match(/\/(?:p|reel)\//)) {
      const reply = document.querySelector('path[d="M20.656 17.008a9.993 9.993 0 1 0-3.59 3.615L22 22Z"]');
      const container = document.querySelector('div[role="presentation"] section') || parentAt(reply, 5);
      if (container) addButton(container, 'post', document.querySelector('article') || document);
    }
  }

  function scanReels() {
    if (!location.pathname.startsWith('/reels/')) return;
    document.querySelectorAll(`path[d="${LIKE}"]`).forEach((like) => {
      const scope = parentAt(like, 8) || document;
      addButton(parentAt(like, 8), 'reel', scope);
    });
  }

  function scanStory() {
    if (!location.pathname.startsWith('/stories/')) return;
    const circle = document.querySelector('svg circle');
    if (circle) addButton(parentAt(circle, 5), 'story', document);
  }

  function scan() {
    unlockImageMenus();
    scanPosts();
    scanReels();
    scanStory();
    refreshHotkeyIndicator();
  }

  function interceptDownloadHotkey(event) {
    if (event.key.toLowerCase() !== 's' || event.ctrlKey || event.altKey || event.metaKey || event.repeat || isTypingTarget(event.target)) return;
    const button = nearestVisibleButton();
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Start once on keydown, but also suppress the matching keypress/keyup:
    // Instagram may bind its Save action to a different keyboard event.
    if (event.type === 'keydown') startDownload(button);
  }

  ['keydown', 'keypress', 'keyup'].forEach((type) => {
    window.addEventListener(type, interceptDownloadHotkey, true);
  });
  window.addEventListener('keydown', interceptCarouselHotkeys, true);

  window.addEventListener('scroll', refreshHotkeyIndicator, { passive: true });
  window.addEventListener('resize', refreshHotkeyIndicator, { passive: true });


  setInterval(scan, 1200);
  scan();
})();
