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
        Err(e) => return Ok(format!("Error: Failed to fetch URL: {}", e)),
    };

    let status = response.status();
    if !status.is_success() {
        return Ok(format!("Error: HTTP {} for {}", status.as_u16(), url));
    }

    let html = match response.text().await {
        Ok(h) => h,
        Err(e) => return Ok(format!("Error: Failed to read response: {}", e)),
    };

    // Extract content using readability
    let url_parsed = match reqwest::Url::parse(&url) {
        Ok(u) => u,
        Err(e) => return Ok(format!("Error: Invalid URL: {}", e)),
    };

    let product = match extractor::extract(&mut html.as_bytes(), &url_parsed) {
        Ok(p) => p,
        Err(e) => return Ok(format!("Error: Failed to extract content: {}", e)),
    };

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
        return Ok("Error: Could not extract readable content from URL".to_string());
    }

    Ok(content)
}
