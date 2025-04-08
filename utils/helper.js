const sanitizeHTML = require("sanitize-html");
const marked = require("marked");

// Configuração do marked
marked.setOptions({
    gfm: true,
    breaks: true,
    pedantic: false,
    smartLists: true,
    smartypants: false
});

/**
 * Processa as marcações aninhadas de classes personalizadas.
 * Suporta múltiplos níveis de aninhamento corretamente.
 */
function processNestedClasses(content) {
    let previousContent;
    const regex = /\[([^\[\]]+)\]{([^{}]+)}/g;

    do {
        previousContent = content;
        content = content.replace(regex, (match, text, classes) => {
            const classList = classes.split(' ');

            // Se houver classe de alinhamento, usa <div>, senão <span>
            const tag = classList.some(cls => cls.startsWith("text-align-") || cls.startsWith("justify-items-") || cls.startsWith("justify-content-")) ? "div" : "span";

            return `<${tag} class="${classList.join(' ')}">${text}</${tag}>`;
        });
    } while (content !== previousContent); // Continua até processar todos os níveis aninhados

    return content;
}

/**
 * Processa imagens que possuem classes personalizadas.
 */
function processImages(content) {
    return content.replace(/!\[(.*?)\]\((.*?)\){(.*?)}/g, (match, alt, src, classes) => {
        const classList = classes.split(' ');

        // Se houver classe de alinhamento, envolve em uma <div>
        if (classList.some(cls => cls.startsWith("justify-items-") || cls.startsWith("justify-content-"))) {
            return `<div class="${classList.join(' ')}"><img src="${src}" alt="${alt}"></div>`;
        }

        return `<img src="${src}" alt="${alt}" class="${classList.join(' ')}">`;
    });
}

/**
 * Função principal para processar e filtrar HTML.
 */
function filterUserHTML(content) {
    console.log("Conteúdo original:", content);

    // Limpeza inicial do conteúdo
    const cleanedContent = content.trim().replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n').replace(/__/g, '*');

    // Processa classes aninhadas e imagens
    const withCustomClasses = processNestedClasses(cleanedContent);
    const withImageClasses = processImages(withCustomClasses);

    // Converte Markdown para HTML
    const htmlContent = marked.parse(withImageClasses);
    console.log("Conteúdo após marked:", htmlContent);

    // Sanitiza o HTML gerado para evitar ataques XSS
    const sanitizedContent = sanitizeHTML(htmlContent, {
        allowedTags: ["p", "br", "ul", "li", "ol", "strong", "b", "i", "em", "h1", "h2", "h3", "h4", "h5", "h6", "span", "img", "div"],
        allowedAttributes: {
            span: ["class"],
            img: ["src", "alt", "class", "style"],
            div: ["class"]
        }
    });

    console.log("Conteúdo após sanitizeHTML:", sanitizedContent);
    return sanitizedContent;
}

module.exports = { filterUserHTML };
