function doGet(e) {
  
  // API calls FIRST
  if (e.parameter.endpoint) {
    return handleApiRequest(e);
  }

  const page = e.parameter.page || "index";

   const template = HtmlService.createTemplateFromFile(page);

  // Pass the web app base URL to the HTML
  template.baseUrl = ScriptApp.getService().getUrl();
  template.appTitle = CONFIG.appTitle; // inject app title
  template.defaultPage = CONFIG.defaultPage;
  template.logoUrl = CONFIG.logoUrl;
  template.wikiUrl = CONFIG.wikiUrl;
  template.rankTooltipText = CONFIG.rankTooltipText;
    
  return template
    .evaluate().addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setTitle(CONFIG.appTitle)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); 
}
