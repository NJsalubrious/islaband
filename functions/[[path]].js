export async function onRequest(context) {
    const { request, env, next } = context;

    // 1. Fetch the static HTML from your Pages deployment
    const response = await next();

    // SAFETY CHECK: Only alter HTML.
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("text/html")) {
        return response;
    }

    try {
        // 2. Pull the master brain from the database
        const kvData = await env.SITT_DAILY_TRENDS.get("current_ecosystem_payload");

        const url = new URL(request.url);
        const hostname = url.hostname.toLowerCase();
        const pathname = url.pathname.toLowerCase();

        if (!kvData) {
            return new HTMLRewriter().on('head', {
                element(e) { e.append(``, { html: true }); }
            }).transform(response);
        }

        const payload = JSON.parse(kvData);
        let targetNode = null;

        if (hostname.includes("ethelryker")) targetNode = "ethel";
        else if (hostname.includes("dominicryker")) targetNode = "dominic";
        else if (hostname.includes("islaband")) targetNode = "isla";
        else if (hostname.includes("pixelstortion")) {
            if (pathname.includes("/zones/silence")) targetNode = "silence";
            else targetNode = "root";
        }

        if (!targetNode || !payload[targetNode]) {
            return new HTMLRewriter().on('head', {
                element(e) { e.append(``, { html: true }); }
            }).transform(response);
        }

        const siteMeta = payload[targetNode];

        // 4. Inject the AI metadata
        return new HTMLRewriter()
            .on('head', {
                element(element) {
                    element.append(``, { html: true });
                    if (siteMeta.title) {
                        element.append(`<title>${siteMeta.title}</title>`, { html: true });
                        element.append(`<meta property="og:title" content="${siteMeta.title}">`, { html: true });
                        element.append(`<meta name="twitter:title" content="${siteMeta.title}">`, { html: true });
                    }
                    if (siteMeta.description) {
                        element.append(`<meta name="description" content="${siteMeta.description}">`, { html: true });
                        element.append(`<meta property="og:description" content="${siteMeta.description}">`, { html: true });
                    }
                    if (siteMeta.schema) {
                        element.append(`<script type="application/ld+json">${JSON.stringify(siteMeta.schema)}</script>`, { html: true });
                    }
                }
            })
            .transform(response);

    } catch (err) {
        console.error("Pages Function error:", err);
        return new HTMLRewriter().on('head', {
            element(e) { e.append(``, { html: true }); }
        }).transform(response);
    }
}
