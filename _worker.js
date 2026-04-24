export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const pathname = url.pathname.toLowerCase();

        // 1. Fetch the static HTML directly from my Pages assets
        const response = await env.ASSETS.fetch(request);

        // SAFETY CHECK: Only alter HTML. Never touch my complex CSS, JS, or Three.js/React!
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("text/html")) {
            return response;
        }

        try {
            // 2. Pull the master brain from the database
            const kvData = await env.SITT_DAILY_TRENDS.get("current_ecosystem_payload");
            if (!kvData) return response;

            const payload = JSON.parse(kvData);

            // 3. The Switchboard: Figure out which site the visitor is on
            const hostname = url.hostname.toLowerCase();

            let targetNode = null;

            if (hostname.includes("ethelryker")) {
                targetNode = "ethel";
            } else if (hostname.includes("dominicryker")) {
                targetNode = "dominic";
            } else if (hostname.includes("islaband")) {
                targetNode = "isla";
            } else if (hostname.includes("silenceisthetrauma") || (hostname.includes("pixelstortion") && pathname.includes("/zones/silence"))) {
                targetNode = "silence";
            } else if (hostname.includes("pixelstortion")) {
                targetNode = "root";
            }

            // If the database is missing that character, serve the normal page
            if (!targetNode || !payload[targetNode]) return response;

            const siteMeta = payload[targetNode];

            // Helper to prevent HTML injection errors
            const escapeHtml = (unsafe) => {
                if (!unsafe) return '';
                return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
            };

            let headInjected = false;

            // 4. Inject the AI metadata — REPLACE, don't duplicate
            return new HTMLRewriter()
                // Remove existing dynamic SEO tags so we don't get stacked/duplicate tags
                .on('title', {
                    element(el) { el.remove(); }
                })
                .on('meta', {
                    element(el) {
                        const name = (el.getAttribute('name') || '').toLowerCase();
                        const prop = (el.getAttribute('property') || '').toLowerCase();
                        
                        const removeList = ['description', 'twitter:title', 'twitter:description', 'keywords'];
                        const removePropList = ['og:title', 'og:description'];
                        
                        if (removeList.includes(name) || removePropList.includes(prop)) {
                            el.remove();
                        }
                    }
                })
                // Append clean, deduplicated AI metadata (including the full keywords array)
                .on('head', {
                    element(el) {
                        if (headInjected) return;
                        headInjected = true;
                        
                        const safeTitle = escapeHtml(siteMeta.title);
                        const safeDesc = escapeHtml(siteMeta.description);
                        let injectedHtml = '';

                        if (siteMeta.title) {
                            injectedHtml += `<title>${safeTitle}</title>\n`;
                            injectedHtml += `<meta property="og:title" content="${safeTitle}">\n`;
                            injectedHtml += `<meta name="twitter:title" content="${safeTitle}">\n`;
                        }
                        if (siteMeta.description) {
                            injectedHtml += `<meta name="description" content="${safeDesc}">\n`;
                            injectedHtml += `<meta property="og:description" content="${safeDesc}">\n`;
                            injectedHtml += `<meta name="twitter:description" content="${safeDesc}">\n`;
                        }
                        if (siteMeta.keywords && Array.isArray(siteMeta.keywords) && siteMeta.keywords.length > 0) {
                            const joinedKeywords = siteMeta.keywords.join(', ');
                            const safeKeywords = escapeHtml(joinedKeywords);
                            injectedHtml += `<meta name="keywords" content="${safeKeywords}">\n`;
                        }

                        // Explicitly DO NOT inject JSON-LD Schema. Preserves the original HTML Schema.
                        el.append(injectedHtml, { html: true });
                    }
                })
                .transform(response);

        } catch (err) {
            console.error("Worker error:", err);
            return response; // Fail gracefully so the site never breaks
        }
    }
};
