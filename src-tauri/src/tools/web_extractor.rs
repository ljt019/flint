use candle_pipelines::text_generation::tool;
use readability::extractor;

#[tool]
/// Get content of one webpage.
pub async fn web_extractor(url: String) -> Result<String, String> {
    // Ensure URL has protocol
    let url = if !url.starts_with("http://") && !url.starts_with("https://") {
        format!("https://{}", url)
    } else {
        url
    };

    // Fetch HTML with timeout
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let html = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    // Extract content using readability
    let url_parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    let product =
        extractor::extract(&mut html.as_bytes(), &url_parsed).map_err(|e| e.to_string())?;

    let mut content = String::new();

    if !product.title.is_empty() {
        content.push_str(&format!("# {}\n\n", product.title));
    }

    content.push_str(&product.text);

    // Truncate to ~8000 chars to avoid blowing context
    if content.len() > 8000 {
        content.truncate(8000);
        content.push_str("\n\n[Content truncated...]");
    }

    if content.trim().is_empty() {
        return Err("Could not extract content from URL".to_string());
    }

    Ok(content)
}
