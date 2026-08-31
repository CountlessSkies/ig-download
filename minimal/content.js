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
    const response = await fetch(apiUrl, {
      credentials: 'include',
      headers: { Accept: '*/*', 'X-IG-App-ID': appId },
    });
    if (!response.ok) throw new Error(`Instagram API: ${response.status}`);
    const item = (await response.json()).items?.[0];
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

  function visibleMediaUrl(article) {
    const articleRect = article.getBoundingClientRect();
    let best = null;
    let bestArea = 0;
    article.querySelectorAll('img, video').forEach((element) => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(0, Math.min(rect.right, articleRect.right) - Math.max(rect.left, articleRect.left));
      const height = Math.max(0, Math.min(rect.bottom, articleRect.bottom) - Math.max(rect.top, articleRect.top));
      const area = width * height;
      if (area > bestArea) {
        bestArea = area;
        best = element.currentSrc || element.src || '';
      }
    });
    return best;
  }

  function carouselIndex(article, parent) {
    const value = new URLSearchParams(location.search).get('img_index');
    if (value) return Math.max(0, Number(value) - 1);
    if (!(article instanceof Element)) return 0;

    // On feed, the actual rendered image is the most reliable carousel state.
    // Match it to the API candidate before consulting Instagram's unstable dots.
    const visiblePath = urlPath(visibleMediaUrl(article));
    if (visiblePath && parent?.carousel_media) {
      const match = parent.carousel_media.findIndex((item) => {
        const candidates = [...(item.image_versions2?.candidates || []), ...(item.video_versions || [])];
        return candidates.some((candidate) => urlPath(candidate.url) === visiblePath);
      });
      if (match >= 0) return match;
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
    const response = await fetch(media.url, { headers: new Headers({ Origin: location.origin }), mode: 'cors' });
    if (!response.ok) throw new Error(`Media request: ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = makeFilename(media);
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
    const colors = { idle: '#0095f6', loading: '#f59e0b', done: '#22a06b', failed: '#ed4956' };
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
      await download(button.dataset.kind, button._igArticle, button);
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

  function isTypingTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  }

  function addButton(container, kind, article) {
    if (!(container instanceof HTMLElement) || container.querySelector(`.${CLASS}[data-kind="${kind}"]`)) return;
    const button = document.createElement('a');
    button.className = CLASS;
    button.dataset.kind = kind;
    button._igArticle = article;
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
  }

  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 's' || event.ctrlKey || event.altKey || event.metaKey || event.repeat || isTypingTarget(event.target)) return;
    const button = nearestVisibleButton();
    if (!button) return;
    event.preventDefault();
    startDownload(button);
  });


  setInterval(scan, 1200);
  scan();
})();
