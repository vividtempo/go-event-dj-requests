function interfaceIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS(svg.namespaceURI, 'use');
    use.setAttribute('href', '/static/images/guest-link-icons.svg?v=3#' + name);
    svg.setAttribute('class', 'link-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.append(use);
    return svg;
}
