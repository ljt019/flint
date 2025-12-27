use candle_pipelines::text_generation::tool;
use scraper::{Html, Selector};

#[tool]
/// Search for information on the internet.
pub async fn web_search(query: String) -> Result<String, String> {
    let url = format!(
        "https://html.duckduckgo.com/html/?q={}",
        urlencoding::encode(&query)
    );

    let client = match reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => return Ok(format!("Error: Failed to create HTTP client: {}", e)),
    };

    let response = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => return Ok(format!("Error: Search request failed: {}", e)),
    };

    let html = match response.text().await {
        Ok(h) => h,
        Err(e) => return Ok(format!("Error: Failed to read search results: {}", e)),
    };

    let doc = Html::parse_document(&html);

    // These selectors are hardcoded and valid, unwrap is safe
    let result_selector = Selector::parse(".results_links").unwrap();
    let title_selector = Selector::parse(".result__a").unwrap();
    let snippet_selector = Selector::parse(".result__snippet").unwrap();
    let url_selector = Selector::parse(".result__url").unwrap();

    let mut results = Vec::new();

    for (i, result) in doc.select(&result_selector).take(5).enumerate() {
        let title = result
            .select(&title_selector)
            .next()
            .map(|el| el.text().collect::<String>())
            .unwrap_or_default();

        let snippet = result
            .select(&snippet_selector)
            .next()
            .map(|el| el.text().collect::<String>())
            .unwrap_or_default();

        let url = result
            .select(&url_selector)
            .next()
            .map(|el| el.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        if !title.is_empty() {
            results.push(format!(
                "[{}] {}\nURL: {}\n{}",
                i + 1,
                title.trim(),
                url,
                snippet.trim()
            ));
        }
    }

    if results.is_empty() {
        return Ok("No results found.".to_string());
    }

    Ok(format!("```\n{}\n```", results.join("\n\n")))
}
