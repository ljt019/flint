use candle_pipelines::text_generation::tool;
use rustpython::vm::{self, AsObject};
use rustpython_stdlib;

#[tool]
/// Execute Python code and return the output. Only Python standard library imports available (math, statistics, json, etc). No third-party packages like numpy or pandas.
pub async fn execute_python(code: String) -> Result<String, String> {
    println!("Python code to execute:\n{}", code);
    // Run in blocking task since RustPython is synchronous
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        vm::Interpreter::with_init(Default::default(), |vm| {
            vm.add_native_modules(rustpython_stdlib::get_module_inits());
        })
        .enter(|vm| {
            let scope = vm.new_scope_with_builtins();

            // Capture stdout
            let output = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
            let output_clone = output.clone();

            // Create a custom print function that captures output
            let print_fn = vm.new_function(
                "print",
                move |args: vm::function::FuncArgs,
                      vm: &vm::VirtualMachine|
                      -> vm::PyResult<vm::PyObjectRef> {
                    let mut out = output_clone.lock().unwrap();
                    for (i, arg) in args.args.iter().enumerate() {
                        if i > 0 {
                            out.push(' ');
                        }
                        out.push_str(arg.str(vm)?.as_str());
                    }
                    out.push('\n');
                    Ok(vm.ctx.none())
                },
            );

            scope
                .globals
                .set_item("print", print_fn.into(), vm)
                .unwrap();

            // Execute the code
            match vm.compile(&code, vm::compiler::Mode::Exec, "<input>".to_owned()) {
                Ok(code_obj) => match vm.run_code_obj(code_obj, scope) {
                    Ok(_) => {
                        let result = output.lock().unwrap().clone();
                        if result.is_empty() {
                            Ok("Code executed successfully (no output).".to_string())
                        } else {
                            Ok(result.trim().to_string())
                        }
                    }
                    Err(exc) => {
                        // Get exception type name and try to get message
                        let exc_name = exc.class().name().to_string();
                        Err(format!("Runtime error: {}", exc_name))
                    }
                },
                Err(err) => Err(format!("Syntax error: {}", err)),
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
