mod tools;

use candle_pipelines::error::PipelineError;
use candle_pipelines::text_generation::{
    tools, AnyTextGenerationPipeline, AnyTextGenerationPipelineExt, Gemma3Size, Message, Qwen3Size,
    TagParts, TextGenerationPipelineBuilder, XmlParser, XmlParserBuilder,
};
use serde::Serialize;
use tauri::async_runtime::Mutex;
use tauri::Emitter;
use tauri::Manager;

use tools::{execute_python::execute_python, web_extractor::web_extractor, web_search::web_search};

// ##############################################
//                   Constants
// ##############################################

const SYSTEM_PROMPT: &str = "
You are a helpful assistant that can answer questions and help with tasks.
If a tool can be used to provide a more accurate answer to the user, use it. Tools can be called sequentially,
so you call one tool, wait for results, either call another tool or return the result to the user depending on results and current task.

If doing math and you can call tools, you should use the execute_python tool to calculate the answer reliably.

When writing code blocks, follow these rules:
- Use proper indentation with 4 spaces per level
- Always put a newline after the language identifier (e.g. ```rust followed by newline, then code)
- Put each statement on its own line
- Format code as you would in a professional codebase
";

// ##############################################
//                   Structs
// ##############################################

#[derive(Serialize, serde::Deserialize, Clone, Copy, strum_macros::EnumIter)]
pub enum AvailableModels {
    Qwen3_0_6B,
    Qwen3_4B,
    Qwen3_8B,
    Qwen3_14B,
    Gemma3_1B,
}

impl AvailableModels {
    fn all() -> Vec<Self> {
        use strum::IntoEnumIterator;
        Self::iter().collect()
    }

    async fn build(&self) -> Result<Box<dyn AnyTextGenerationPipeline>, AppError> {
        let pipeline: Box<dyn AnyTextGenerationPipeline> = match self {
            Self::Qwen3_0_6B => Box::new(Self::build_qwen3(Qwen3Size::Size0_6B).await?),
            Self::Qwen3_4B => Box::new(Self::build_qwen3(Qwen3Size::Size4B).await?),
            Self::Qwen3_8B => Box::new(Self::build_qwen3(Qwen3Size::Size8B).await?),
            Self::Qwen3_14B => Box::new(Self::build_qwen3(Qwen3Size::Size14B).await?),
            Self::Gemma3_1B => Box::new(Self::build_gemma3(Gemma3Size::Size1B).await?),
        };
        Ok(pipeline)
    }

    async fn build_qwen3(size: Qwen3Size) -> Result<impl AnyTextGenerationPipeline, PipelineError> {
        let p = TextGenerationPipelineBuilder::qwen3(size)
            .cuda(0)
            .build()
            .await?;
        p.register_tools(tools![web_search, web_extractor, execute_python])
            .await;
        p.clear_cache().await;
        Ok(p)
    }

    async fn build_gemma3(
        size: Gemma3Size,
    ) -> Result<impl AnyTextGenerationPipeline, PipelineError> {
        let p = TextGenerationPipelineBuilder::gemma3(size)
            .cuda(0)
            .build()
            .await?;
        p.register_tools(tools![web_search, web_extractor, execute_python])
            .await;
        p.clear_cache().await;
        Ok(p)
    }
}

pub struct AppData {
    active_model: Mutex<Option<AvailableModels>>,
    pipeline: Mutex<Option<Box<dyn AnyTextGenerationPipeline>>>,
    parser: XmlParser,
    reasoning_enabled: Mutex<bool>,
}

#[derive(thiserror::Error, Debug, Serialize)]
pub enum AppError {
    #[error("{0}")]
    PipelineError(String),
    #[error("{0}")]
    TauriError(String),
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::TauriError(e.to_string())
    }
}

impl From<PipelineError> for AppError {
    fn from(e: PipelineError) -> Self {
        AppError::PipelineError(e.to_string())
    }
}

// ##############################################
//                   Commands
// ##############################################

#[tauri::command]
async fn switch_model(app: tauri::AppHandle, model: AvailableModels) -> Result<(), AppError> {
    let new_pipeline = model.build().await?;
    let state = app.state::<AppData>();
    *state.pipeline.lock().await = None;
    std::thread::sleep(std::time::Duration::from_secs(1));
    *state.pipeline.lock().await = Some(new_pipeline);
    *state.active_model.lock().await = Some(model);
    Ok(())
}

#[tauri::command]
async fn get_active_model(app: tauri::AppHandle) -> Option<AvailableModels> {
    let state = app.state::<AppData>();
    let model = state.active_model.lock().await.clone();
    model
}

#[tauri::command]
async fn set_reasoning(app: tauri::AppHandle, reasoning: bool) -> Result<(), AppError> {
    let state = app.state::<AppData>();
    *state.reasoning_enabled.lock().await = reasoning;
    Ok(())
}

#[tauri::command]
async fn can_toggle_reasoning(app: tauri::AppHandle) -> Result<bool, AppError> {
    let state = app.state::<AppData>();
    let pipeline = state.pipeline.lock().await;

    let Some(ref pipeline) = *pipeline else {
        return Err(AppError::PipelineError("No pipeline available".to_string()));
    };

    return Ok(pipeline.as_toggleable_reasoning().is_some());
}

#[tauri::command]
async fn available_models() -> Vec<AvailableModels> {
    AvailableModels::all()
}

#[tauri::command]
async fn completion(app: tauri::AppHandle, messages: Vec<Message>) -> Result<(), AppError> {
    let state = app.state::<AppData>();
    let pipeline = state.pipeline.lock().await;
    let reasoning_enabled = state.reasoning_enabled.lock().await;

    let mut messages = messages;
    messages.insert(0, Message::system(SYSTEM_PROMPT));

    let Some(ref pipeline) = *pipeline else {
        return Err(AppError::PipelineError("No pipeline available".to_string()));
    };

    pipeline.with_toggleable_reasoning(|pipeline| pipeline.enable_reasoning(*reasoning_enabled));

    let stream = pipeline.completion_stream(&messages).await?;
    let mut events = state.parser.wrap_stream(stream);

    app.emit("completion-start", ())?;
    while let Some(event) = events.next().await {
        if event.is_error() {
            eprintln!("Stream error: {}", event.error_message().unwrap());
            break;
        }

        match event.tag() {
            Some("tool_result") => match event.part() {
                TagParts::Content => {
                    app.emit("tool-result", &event.get_content())?;
                }
                _ => {}
            },
            Some("tool_call") => match event.part() {
                TagParts::End => {
                    if let Some((name, args)) = event.parse_tool_call() {
                        app.emit("tool-call", (name, args))?;
                    }
                }
                _ => {}
            },
            Some("think") => match event.part() {
                TagParts::Start => {
                    app.emit("thinking-start", ())?;
                }
                TagParts::Content => {
                    app.emit("thinking-token", &event.get_content())?;
                }
                TagParts::End => {
                    app.emit("thinking-end", ())?;
                }
            },
            Some(_) => {
                println!("Unknown tag: {}", event.tag().unwrap());
            }
            None => {
                let content = event.get_content();
                app.emit("token", &content)?;
            }
        }
    }
    app.emit("completion-end", ())?;
    Ok(())
}

// ##############################################
//                   Main
// ##############################################

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let parser = XmlParserBuilder::new()
                .register_tag("tool_result")
                .register_tag("tool_call")
                .register_tag("think")
                .build();

            app.manage(AppData {
                active_model: Mutex::new(None),
                pipeline: Mutex::new(None),
                parser,
                reasoning_enabled: Mutex::new(false),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            completion,
            switch_model,
            get_active_model,
            can_toggle_reasoning,
            set_reasoning,
            available_models,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
