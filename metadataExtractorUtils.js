export async function extractFromHtml(
  html,
  url,
  rule = { allow: [], deny: [] },
) {
  const result = {
    imageUrls: [],
    imageUrl: null,
    publishedAt: null,
    description: null,
    summary: null,
    keywords: null,
    author: null,
    siteName: null,
    canonical: null,
    type: null,
    locale: null,
    iframes: [],
  };

  try {
    if (typeof DOMParser === 'undefined') {
      // DOMParser is not available in MV3 service workers; skip HTML parsing.
      return result;
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const allowSelectors = Array.isArray(rule.allow) ? rule.allow : [];
    const denySelectors = Array.isArray(rule.deny) ? rule.deny : [];

    const matchesAny = (el, selectors) =>
      selectors.some(sel => {
        try {
          return el.matches(sel);
        } catch {
          return false;
        }
      });

    const isAllowed = el =>
      !allowSelectors.length || matchesAny(el, allowSelectors);
    const isDenied = el => matchesAny(el, denySelectors);

    const isSvg = url => {
      const u = url.trim().toLowerCase();
      return u.endsWith('.svg') || u.startsWith('data:image/svg');
    };

    const seen = new Set();
    const metaUrls = [];
    const imgUrls = [];
    const pushImageUrl = raw => {
      if (!raw) return;
      const trimmed = raw.trim();
      if (!trimmed) return;
      if (
        trimmed.startsWith('data:') ||
        trimmed.startsWith('about:') ||
        trimmed.startsWith('javascript:')
      )
        return;
      const abs = absolutizeUrl(trimmed, url);
      if (!abs || seen.has(abs) || isSvg(abs) || isBlockedMeta(abs)) return;
      seen.add(abs);
      metaUrls.push(abs);
    };

    PREVIEW_IMAGE_SELECTORS.forEach(sel => {
      doc.querySelectorAll(sel).forEach(el => {
        if (isDenied(el)) return;
        const raw =
          el.getAttribute('content') ||
          el.getAttribute('href') ||
          el.content ||
          el.href;
        if (raw) pushImageUrl(raw);
      });
    });

    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        const jsonLd = Array.isArray(data) ? data[0] : data;
        const image = jsonLd?.image;
        const queue = Array.isArray(image) ? image : [image];
        queue.forEach(value => {
          if (typeof value === 'object' && value) {
            pushImageUrl(value.url || value.contentUrl || value.image);
          } else if (value) {
            pushImageUrl(String(value));
          }
        });
      } catch {
        // Ignore malformed structured data.
      }
    }

    // Visible images from HTML (best-effort without size checks)
    doc.querySelectorAll('img').forEach(img => {
      if (isDenied(img)) return;
      if (!isAllowed(img)) return;
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      if (!src) return;
      const abs = absolutizeUrl(src, url);
      if (!abs || seen.has(abs) || isSvg(abs)) return;
      seen.add(abs);
      imgUrls.push(abs);
    });

    let iconUrl = null;
    const iconEl = doc.querySelector('link[rel*="icon"]');
    if (iconEl && !isDenied(iconEl)) {
      const href = iconEl.getAttribute('href');
      const abs = absolutizeUrl(href, url);
      if (abs && !isSvg(abs) && !isBlockedMeta(abs)) {
        iconUrl = abs;
      }
    }

    const combined = metaUrls.concat(imgUrls);
    if (!combined.length && iconUrl) combined.push(iconUrl);

    result.imageUrls = combined;
    result.imageUrl = combined[0] || null;

    // Extract metadata
    const extractJsonLd = () => {
      const scripts = doc.querySelectorAll(
        'script[type="application/ld+json"]',
      );
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);
          if (data) return Array.isArray(data) ? data[0] : data;
        } catch {}
      }
      return null;
    };

    const jsonLd = extractJsonLd();

    // Published date
    if (jsonLd?.datePublished) {
      result.publishedAt = new Date(jsonLd.datePublished).getTime();
    } else {
      const dateSelectors = [
        'meta[property="article:published_time"]',
        'meta[name="publish_date"]',
        'meta[name="date"]',
        'meta[property="og:published_time"]',
      ];
      for (const sel of dateSelectors) {
        const el = doc.querySelector(sel);
        const content = el?.getAttribute('content');
        if (content) {
          const timestamp = new Date(content).getTime();
          if (!isNaN(timestamp)) {
            result.publishedAt = timestamp;
            break;
          }
        }
      }
    }

    // Description
    if (jsonLd?.description) {
      result.description = jsonLd.description.trim();
    } else {
      const descSelectors = [
        'meta[property="og:description"]',
        'meta[name="description"]',
        'meta[name="twitter:description"]',
      ];
      for (const sel of descSelectors) {
        const el = doc.querySelector(sel);
        const content = el?.getAttribute('content');
        if (content) {
          result.description = content.trim();
          break;
        }
      }
    }

    // Keywords
    const keywords = [];
    const kwSeen = new Set();
    if (jsonLd?.keywords) {
      const kw = Array.isArray(jsonLd.keywords)
        ? jsonLd.keywords
        : jsonLd.keywords.split(',');
      kw.forEach(k => {
        const cleaned = k.trim();
        if (cleaned && !kwSeen.has(cleaned)) {
          kwSeen.add(cleaned);
          keywords.push(cleaned);
        }
      });
    }

    const metaKeywords = doc.querySelector('meta[name="keywords"]');
    if (metaKeywords) {
      const content = metaKeywords.getAttribute('content') || '';
      content.split(',').forEach(k => {
        const cleaned = k.trim();
        if (cleaned && !kwSeen.has(cleaned)) {
          kwSeen.add(cleaned);
          keywords.push(cleaned);
        }
      });
    }

    const metaTags = doc.querySelectorAll('meta[property="article:tag"]');
    metaTags.forEach(tag => {
      const content = tag.getAttribute('content');
      if (content && !kwSeen.has(content)) {
        kwSeen.add(content);
        keywords.push(content);
      }
    });

    if (keywords.length > 0) result.keywords = keywords;

    // Author
    const authorMeta = doc.querySelector('meta[name="author"]');
    if (authorMeta?.content) {
      result.author = authorMeta.content.trim();
    } else if (jsonLd?.author?.name) {
      result.author = jsonLd.author.name;
    }

    // Site Name
    const siteNameMeta = doc.querySelector('meta[property="og:site_name"]');
    if (siteNameMeta?.content) {
      result.siteName = siteNameMeta.content.trim();
    }

    // Canonical URL
    const canonicalLink = doc.querySelector('link[rel="canonical"]');
    if (canonicalLink?.href) {
      result.canonical = canonicalLink.href.trim();
    }

    // Content Type
    const typeMeta = doc.querySelector('meta[property="og:type"]');
    if (typeMeta?.content) {
      result.type = typeMeta.content.trim();
    }

    // Locale
    const localeMeta = doc.querySelector('meta[property="og:locale"]');
    if (localeMeta?.content) {
      result.locale = localeMeta.content.trim();
    }

    // Summary: combine description + first paragraph
    if (result.description) {
      result.summary = result.description;
    }
    // Try to get first paragraph for richer summary
    const firstParagraph = doc.querySelector(
      'article p, .entry-content p, .post-content p, main p',
    );
    if (firstParagraph?.textContent) {
      const paragraphText = firstParagraph.textContent.trim();
      if (paragraphText.length > 50) {
        if (result.summary && result.summary !== paragraphText) {
          // Combine both if different
          result.summary = `${result.summary}\n\n${paragraphText}`;
        } else if (!result.summary) {
          result.summary = paragraphText;
        }
      }
    }

    // iframes
    const iframes = doc.querySelectorAll('iframe');
    const iframeUrls = [];
    iframes.forEach(iframe => {
      const src = iframe.getAttribute('src');
      if (src && src.trim()) {
        const absoluteSrc = absolutizeUrl(src, url);
        if (absoluteSrc && !iframeUrls.includes(absoluteSrc)) {
          iframeUrls.push(absoluteSrc);
        }
      }
    });
    if (iframeUrls.length > 0) {
      result.iframes = iframeUrls;
    }
  } catch (err) {
    console.warn('[LaterList] HTML extraction failed:', err);
  }

  return result;
}

export async function extractFromUrl(url, rule = { allow: [], deny: [] }) {
  try {
    const res = await fetch(url, { redirect: 'follow', credentials: 'omit' });
    if (!res.ok) return { imageUrls: [], imageUrl: null };
    const html = await res.text();
    return await extractFromHtml(html, url, rule);
  } catch (err) {
    console.warn('[LaterList] extractFromUrl failed for', url, err);
    return { imageUrls: [], imageUrl: null };
  }
}

export async function extractFromTab(
  tabId,
  pageUrl,
  rule = { allow: [], deny: [] },
) {
  const result = {
    imageUrls: [],
    imageUrl: null,
    publishedAt: null,
    description: null,
    summary: null,
    keywords: null,
    author: null,
    siteName: null,
    canonical: null,
    type: null,
    locale: null,
    iframes: [],
  };

  try {
    // Safety check: only extract from http/https URLs
    if (
      !pageUrl ||
      (!pageUrl.startsWith('http://') && !pageUrl.startsWith('https://'))
    ) {
      return result;
    }

    const allowSelectors = Array.isArray(rule.allow) ? rule.allow : [];
    const denySelectors = Array.isArray(rule.deny) ? rule.deny : [];

    // Extract images
    const imageResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (allowSelectors, denySelectors) => {
        const testImageUrl = (url, timeout = 3000) => {
          return new Promise(resolve => {
            const img = new Image();
            const MIN_DIM = 128;
            const timer = setTimeout(() => {
              img.onload = null;
              img.onerror = null;
              resolve(false);
            }, timeout);
            img.onload = () => {
              clearTimeout(timer);
              resolve(
                img.naturalWidth >= MIN_DIM && img.naturalHeight >= MIN_DIM,
              );
            };
            img.onerror = () => {
              clearTimeout(timer);
              resolve(false);
            };
            img.src = url;
          });
        };

        const matchesAny = (el, selectors) =>
          selectors.some(sel => {
            try {
              return el.matches(sel);
            } catch {
              return false;
            }
          });

        const isAllowed = el =>
          !allowSelectors.length || matchesAny(el, allowSelectors);
        const isDenied = el => matchesAny(el, denySelectors);

        const candidates = [];
        const seen = new Set();

        const isSvg = url => {
          const u = url.trim().toLowerCase();
          return u.endsWith('.svg') || u.startsWith('data:image/svg');
        };

        const isBlockedMeta = url => {
          const lowered = url.trim().toLowerCase();
          const pattern = /logo|icon|sprite|favicon|social|share/;
          if (pattern.test(lowered)) return true;
          try {
            const parsed = new URL(url, location.href);
            const path = parsed.pathname.toLowerCase();
            if (path.includes('favicon')) return true;
            const file = path.split('/').pop() || '';
            return pattern.test(file);
          } catch {
            return false;
          }
        };

        const toAbsoluteUrl = raw => {
          if (!raw) return null;
          try {
            return new URL(raw, location.href).href;
          } catch {
            return null;
          }
        };

        const add = url => {
          const abs = toAbsoluteUrl(url);
          if (!abs || seen.has(abs) || isSvg(abs) || isBlockedMeta(abs)) return;
          seen.add(abs);
          candidates.push(abs);
        };

        const visibleEnough = img => {
          if (
            !img.complete ||
            img.naturalWidth === 0 ||
            img.naturalHeight === 0
          )
            return false;
          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          if (w < 128 || h < 128) return false;
          const ratio = w / h;
          return ratio > 0.3 && ratio < 3.5 && img.offsetParent !== null;
        };

        const isInExcludedContext = img => {
          const selectors = [
            'nav',
            'header',
            'footer',
            'aside',
            'form',
            'button',
            '[role="navigation"]',
            '[role="banner"]',
            '[role="contentinfo"]',
            '[role="toolbar"]',
            '[role="tablist"]',
            '[aria-label*="breadcrumb" i]',
            '.sidebar',
            '.menu',
          ];
          return Boolean(img.closest(selectors.join(',')));
        };

        // Meta tags first
        const metaSelectors = [
          'meta[property="og:image"]',
          'meta[property="og:image:url"]',
          'meta[property="og:image:secure_url"]',
          'meta[property="twitter:image"]',
          'meta[property="twitter:image:src"]',
          'meta[name="twitter:image"]',
          'meta[name="twitter:image:src"]',
          'meta[itemprop="image"]',
          'meta[name="thumbnail"]',
          'meta[property="thumbnail"]',
          'meta[property="article:image"]',
          'link[rel="image_src"]',
        ];
        const metaUrls = [];
        const metaSeen = new Set();
        const addPreviewImage = raw => {
          const abs = toAbsoluteUrl(raw);
          if (!abs || metaSeen.has(abs) || isSvg(abs) || isBlockedMeta(abs)) {
            return;
          }
          metaSeen.add(abs);
          metaUrls.push(abs);
        };
        metaSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            if (isDenied(el)) return;
            const val =
              el.getAttribute('content') ||
              el.getAttribute('href') ||
              el.content ||
              el.href;
            if (!val) return;
            addPreviewImage(val);
          });
        });

        const scripts = document.querySelectorAll(
          'script[type="application/ld+json"]',
        );
        for (const script of scripts) {
          try {
            const data = JSON.parse(script.textContent);
            const jsonLd = Array.isArray(data) ? data[0] : data;
            const image = jsonLd?.image;
            const queue = Array.isArray(image) ? image : [image];
            queue.forEach(value => {
              if (typeof value === 'object' && value) {
                addPreviewImage(value.url || value.contentUrl || value.image);
              } else if (value) {
                addPreviewImage(String(value));
              }
            });
          } catch {
            // Ignore malformed structured data.
          }
        }

        const validationPromises = metaUrls.map(async url => {
          const isValid = await testImageUrl(url);
          return isValid ? url : null;
        });
        const validatedMeta = (await Promise.all(validationPromises)).filter(
          Boolean,
        );
        validatedMeta.forEach(v => {
          seen.add(v);
          candidates.push(v);
        });

        // Visible images next
        document.querySelectorAll('img').forEach(img => {
          if (!visibleEnough(img)) return;
          if (isInExcludedContext(img)) return;
          if (isDenied(img)) return;
          if (!isAllowed(img)) return;
          const src = img.currentSrc || img.src || img.getAttribute('data-src');
          add(src);
        });

        // Icon fallback only if nothing else
        let iconUrl = null;
        const icon = document.querySelector('link[rel*="icon"]');
        if (icon?.href && !validatedMeta.length && !candidates.length) {
          if (!isDenied(icon)) {
            const val = icon.href;
            if (!seen.has(val) && !isSvg(val) && !isBlockedMeta(val)) {
              const ok = await testImageUrl(val);
              if (ok) iconUrl = val;
            }
          }
        }

        const combined = [...validatedMeta, ...candidates];
        if (!combined.length && iconUrl) combined.push(iconUrl);
        return combined;
      },
      args: [allowSelectors, denySelectors],
      world: 'MAIN',
    });

    const imageUrls = imageResults?.[0]?.result || [];
    result.imageUrls = imageUrls;
    result.imageUrl = imageUrls[0] || null;

    // Extract metadata
    const metaResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const extractJsonLd = () => {
          const scripts = document.querySelectorAll(
            'script[type="application/ld+json"]',
          );
          for (const script of scripts) {
            try {
              const data = JSON.parse(script.textContent);
              if (data) return Array.isArray(data) ? data[0] : data;
            } catch {}
          }
          return null;
        };

        const extractPublishedDate = () => {
          const jsonLd = extractJsonLd();
          if (jsonLd?.datePublished)
            return new Date(jsonLd.datePublished).getTime();
          const metaSelectors = [
            'meta[property="article:published_time"]',
            'meta[name="publish_date"]',
            'meta[name="date"]',
            'meta[property="og:published_time"]',
          ];
          for (const sel of metaSelectors) {
            const el = document.querySelector(sel);
            const content = el?.getAttribute('content');
            if (content) {
              const timestamp = new Date(content).getTime();
              if (!isNaN(timestamp)) return timestamp;
            }
          }
          return null;
        };

        const extractDescription = () => {
          const jsonLd = extractJsonLd();
          if (jsonLd?.description) return jsonLd.description.trim();
          const metaSelectors = [
            'meta[property="og:description"]',
            'meta[name="description"]',
            'meta[name="twitter:description"]',
          ];
          for (const sel of metaSelectors) {
            const el = document.querySelector(sel);
            const content = el?.getAttribute('content');
            if (content) return content.trim();
          }
          const firstP = document.querySelector('article p, main p, p');
          if (firstP?.textContent) {
            const text = firstP.textContent.trim();
            return text.length > 300 ? text.slice(0, 300) + '...' : text;
          }
          return null;
        };

        const extractSummary = () => {
          const selectors = [
            'article',
            'main',
            '[role="main"]',
            '.article-content',
            '.post-content',
            '.entry-content',
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
              const text = el.innerText || el.textContent || '';
              const cleaned = text.trim().replace(/\s+/g, ' ');
              if (cleaned.length > 50) {
                return cleaned.length > 500
                  ? cleaned.slice(0, 500) + '...'
                  : cleaned;
              }
            }
          }
          return null;
        };

        const extractKeywords = () => {
          const keywords = [];
          const seen = new Set();
          const jsonLd = extractJsonLd();
          if (jsonLd?.keywords) {
            const kw = Array.isArray(jsonLd.keywords)
              ? jsonLd.keywords
              : jsonLd.keywords.split(',');
            kw.forEach(k => {
              const cleaned = k.trim();
              if (cleaned && !seen.has(cleaned)) {
                seen.add(cleaned);
                keywords.push(cleaned);
              }
            });
          }
          const metaKeywords = document.querySelector('meta[name="keywords"]');
          if (metaKeywords) {
            const content = metaKeywords.getAttribute('content') || '';
            content.split(',').forEach(k => {
              const cleaned = k.trim();
              if (cleaned && !seen.has(cleaned)) {
                seen.add(cleaned);
                keywords.push(cleaned);
              }
            });
          }
          const metaTags = document.querySelectorAll(
            'meta[property="article:tag"]',
          );
          metaTags.forEach(tag => {
            const content = tag.getAttribute('content');
            if (content && !seen.has(content)) {
              seen.add(content);
              keywords.push(content);
            }
          });
          return keywords.length > 0 ? keywords : null;
        };

        const extractAuthor = () => {
          const authorMeta = document.querySelector('meta[name="author"]');
          if (authorMeta?.content) return authorMeta.content.trim();
          const jsonLd = extractJsonLd();
          if (jsonLd?.author?.name) return jsonLd.author.name;
          return null;
        };

        const extractSiteName = () => {
          const siteNameMeta = document.querySelector(
            'meta[property="og:site_name"]',
          );
          if (siteNameMeta?.content) return siteNameMeta.content.trim();
          return null;
        };

        const extractCanonical = () => {
          const canonicalLink = document.querySelector('link[rel="canonical"]');
          if (canonicalLink?.href) return canonicalLink.href.trim();
          return null;
        };

        const extractType = () => {
          const typeMeta = document.querySelector('meta[property="og:type"]');
          if (typeMeta?.content) return typeMeta.content.trim();
          return null;
        };

        const extractLocale = () => {
          const localeMeta = document.querySelector(
            'meta[property="og:locale"]',
          );
          if (localeMeta?.content) return localeMeta.content.trim();
          return null;
        };

        const extractIframes = () => {
          const iframes = document.querySelectorAll('iframe');
          const iframeUrls = [];
          iframes.forEach(iframe => {
            const src = iframe.getAttribute('src');
            if (src && src.trim()) {
              try {
                // Convert to absolute URL
                const absoluteSrc = new URL(src, document.baseURI).href;
                if (!iframeUrls.includes(absoluteSrc)) {
                  iframeUrls.push(absoluteSrc);
                }
              } catch (e) {
                // Ignore invalid URLs
              }
            }
          });
          return iframeUrls.length > 0 ? iframeUrls : null;
        };

        return {
          publishedAt: extractPublishedDate(),
          description: extractDescription(),
          summary: extractSummary(),
          keywords: extractKeywords(),
          author: extractAuthor(),
          siteName: extractSiteName(),
          canonical: extractCanonical(),
          type: extractType(),
          locale: extractLocale(),
          iframes: extractIframes(),
        };
      },
    });

    const meta = metaResults?.[0]?.result || {};
    result.publishedAt = meta.publishedAt;
    result.description = meta.description;
    result.summary = meta.summary;
    result.keywords = meta.keywords;
    result.author = meta.author;
    result.siteName = meta.siteName;
    result.canonical = meta.canonical;
    result.type = meta.type;
    result.locale = meta.locale;
    result.iframes = meta.iframes || [];
    result.type = meta.type;
    result.locale = meta.locale;
  } catch (err) {
    console.warn('[LaterList] Extraction failed:', err);
  }

  return result;
}
