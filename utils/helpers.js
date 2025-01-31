const sanitizeHTML = require("sanitize-html");
const marked = require("marked");

function filterUserHTML(content) {
    return sanitizeHTML(marked.parse(content), {
        allowedTags: ["p", "br", "ul", "li", "ol", "strong", "bold", "i", "em", "h1", "h2", "h3", "h4", "h5", "h6"],
        allowedAttributes: {}
    });
}

module.exports = { filterUserHTML };