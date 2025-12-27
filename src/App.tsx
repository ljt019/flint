import { useEffect, useRef, useState } from "react";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Brain, Hammer, ChevronRight, MessageSquarePlus, Search, Globe, Code } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

// Catppuccin Mocha theme for syntax highlighting
const catppuccinMocha = {
  'code[class*="language-"]': {
    color: "#cdd6f4",
    background: "none",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "0.875em",
    textAlign: "left",
    whiteSpace: "pre",
    wordSpacing: "normal",
    wordBreak: "normal",
    wordWrap: "normal",
    lineHeight: "1.5",
  },
  'pre[class*="language-"]': {
    color: "#cdd6f4",
    background: "#1e1e2e",
    padding: "1em",
    margin: "0",
    overflow: "auto",
    borderRadius: "0.5rem",
  },
  comment: { color: "#6c7086", fontStyle: "italic" },
  prolog: { color: "#6c7086" },
  doctype: { color: "#6c7086" },
  cdata: { color: "#6c7086" },
  punctuation: { color: "#bac2de" },
  property: { color: "#89b4fa" },
  tag: { color: "#89b4fa" },
  boolean: { color: "#fab387" },
  number: { color: "#fab387" },
  constant: { color: "#fab387" },
  symbol: { color: "#f38ba8" },
  deleted: { color: "#f38ba8" },
  selector: { color: "#a6e3a1" },
  "attr-name": { color: "#a6e3a1" },
  string: { color: "#a6e3a1" },
  char: { color: "#a6e3a1" },
  builtin: { color: "#94e2d5" },
  inserted: { color: "#a6e3a1" },
  operator: { color: "#89dceb" },
  entity: { color: "#f9e2af", cursor: "help" },
  url: { color: "#89dceb" },
  ".language-css .token.string": { color: "#89dceb" },
  ".style .token.string": { color: "#89dceb" },
  variable: { color: "#cdd6f4" },
  atrule: { color: "#cba6f7" },
  "attr-value": { color: "#a6e3a1" },
  function: { color: "#89b4fa" },
  "class-name": { color: "#f9e2af" },
  keyword: { color: "#cba6f7" },
  regex: { color: "#f5c2e7" },
  important: { color: "#cba6f7", fontWeight: "bold" },
  bold: { fontWeight: "bold" },
  italic: { fontStyle: "italic" },
} as { [key: string]: React.CSSProperties };

type Message = { role: "user" | "assistant" | "system"; content: string };
type MessageItem =
  | { type: "user"; content: string }
  | { type: "assistant"; content: string; thinking?: string }
  | { type: "tool"; name: string; args: unknown; result?: string };

type AvailableModels = string;

const MODEL_LABELS: Record<string, string> = {
  Qwen3_0_6B: "Qwen3 0.6B",
  Qwen3_4B: "Qwen3 4B",
  Qwen3_8B: "Qwen3 8B",
  Qwen3_14B: "Qwen3 14B",
  Gemma3_1B: "Gemma3 1B",
};

// Chain wrapper - renders seamless vertical line behind items
function ChainWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {/* Single seamless line from top icon center to bottom icon center */}
      <div className="absolute left-[10px] top-[10px] bottom-[10px] w-[2px] -translate-x-px bg-muted-foreground/30" />
      <div className="relative">{children}</div>
    </div>
  );
}

// Single chain item with icon cutout
function ChainItem({
  icon,
  label,
  children,
  onIconClick,
  iconHoverable,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  children?: React.ReactNode;
  onIconClick?: () => void;
  iconHoverable?: boolean;
}) {
  const iconElement = (
    <div
      className={cn(
        "flex items-center justify-center w-5 h-5 shrink-0 bg-background rounded z-10",
        iconHoverable && "hover:bg-muted cursor-pointer transition-colors"
      )}
      onClick={onIconClick}
    >
      {icon}
    </div>
  );

  return (
    <div className="flex gap-3">
      {iconElement}
      <div className="flex-1 pb-2">
        <div className="h-5 flex items-center">{label}</div>
        {children}
      </div>
    </div>
  );
}

function ThinkingBlock({ content, isComplete }: { content: string; isComplete?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Auto-collapse when thinking completes
  useEffect(() => {
    if (isComplete) {
      const timer = setTimeout(() => setCollapsed(true), 100);
      return () => clearTimeout(timer);
    }
  }, [isComplete]);

  const icon =
    isComplete && hovered ? (
      <ChevronRight
        className={cn(
          "h-3 w-3 text-muted-foreground transition-transform",
          !collapsed && "rotate-90"
        )}
      />
    ) : (
      <Brain className="h-3 w-3 text-muted-foreground" />
    );

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="select-none"
    >
      <ChainItem
        icon={icon}
        iconHoverable={isComplete}
        onIconClick={() => isComplete && setCollapsed(!collapsed)}
        label={
          isComplete ? (
            <span className="text-xs font-medium text-muted-foreground">Thought</span>
          ) : (
            <span className="text-xs font-medium bg-linear-to-r from-muted-foreground via-foreground to-muted-foreground bg-size-[200%_100%] bg-clip-text text-transparent animate-[shimmer_2s_infinite]">
              Thinking
            </span>
          )
        }
      >
        {!collapsed && (
          <p className="text-xs text-muted-foreground/70 whitespace-pre-wrap leading-relaxed mt-1 select-text">
            {content}
          </p>
        )}
      </ChainItem>
    </div>
  );
}

function ToolCallBlock({
  name,
  args,
  result,
}: {
  name: string;
  args: Record<string, unknown>;
  result?: string;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const hasResult = !!result;

  // Custom renderings for known tools
  if (name === "web_search") {
    return (
      <div onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        <ChainItem
          icon={
            hasResult && isHovered ? (
              <ChevronRight
                className={cn(
                  "h-3 w-3 text-muted-foreground transition-transform",
                  !collapsed && "rotate-90"
                )}
              />
            ) : (
              <Search className="h-3 w-3 text-muted-foreground" />
            )
          }
          label={
            hasResult ? (
              <span className="text-xs text-muted-foreground">
                Searched <span className="font-medium">"{String(args.query)}"</span>
              </span>
            ) : (
              <span className="text-xs bg-linear-to-r from-muted-foreground via-foreground to-muted-foreground bg-size-[200%_100%] bg-clip-text text-transparent animate-[shimmer_2s_infinite]">
                Searching <span className="font-medium">"{String(args.query)}"</span>
              </span>
            )
          }
          onIconClick={hasResult ? () => setCollapsed(!collapsed) : undefined}
          iconHoverable={hasResult}
        >
          {hasResult && !collapsed && (
            <div className="text-xs text-muted-foreground/70 font-mono whitespace-pre-wrap mt-1">
              {result
                ?.trim()
                .replace(/^```\n?/, "")
                .replace(/\n?```$/, "")
                .trim()}
            </div>
          )}
        </ChainItem>
      </div>
    );
  }

  if (name === "web_extractor") {
    const url = String(args.url || "");
    const displayUrl = url.replace(/^https?:\/\//, "").slice(0, 40) + (url.length > 50 ? "…" : "");
    return (
      <div onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        <ChainItem
          icon={
            hasResult && isHovered ? (
              <ChevronRight
                className={cn(
                  "h-3 w-3 text-muted-foreground transition-transform",
                  !collapsed && "rotate-90"
                )}
              />
            ) : (
              <Globe className="h-3 w-3 text-muted-foreground" />
            )
          }
          label={
            hasResult ? (
              <span className="text-xs text-muted-foreground">
                Read <span className="font-mono">{displayUrl}</span>
              </span>
            ) : (
              <span className="text-xs bg-linear-to-r from-muted-foreground via-foreground to-muted-foreground bg-size-[200%_100%] bg-clip-text text-transparent animate-[shimmer_2s_infinite]">
                Reading <span className="font-mono">{displayUrl}</span>
              </span>
            )
          }
          onIconClick={hasResult ? () => setCollapsed(!collapsed) : undefined}
          iconHoverable={hasResult}
        >
          {hasResult && !collapsed && (
            <div className="text-xs text-muted-foreground/70 font-mono whitespace-pre-wrap mt-1">
              {result}
            </div>
          )}
        </ChainItem>
      </div>
    );
  }

  if (name === "execute_python") {
    const code = String(args.code || "");
    return (
      <div onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        <ChainItem
          icon={
            hasResult && isHovered ? (
              <ChevronRight
                className={cn(
                  "h-3 w-3 text-muted-foreground transition-transform",
                  !collapsed && "rotate-90"
                )}
              />
            ) : (
              <Code className="h-3 w-3 text-muted-foreground" />
            )
          }
          label={
            hasResult ? (
              <span className="text-xs text-muted-foreground">Python</span>
            ) : (
              <span className="text-xs bg-linear-to-r from-muted-foreground via-foreground to-muted-foreground bg-size-[200%_100%] bg-clip-text text-transparent animate-[shimmer_2s_infinite]">
                Python
              </span>
            )
          }
          onIconClick={hasResult ? () => setCollapsed(!collapsed) : undefined}
          iconHoverable={hasResult}
        >
          {hasResult && !collapsed && (
            <div className="mt-2 space-y-2">
              <div>
                <div className="text-xs text-muted-foreground/50 mb-1">Input</div>
                <div className="text-xs text-muted-foreground/70 font-mono whitespace-pre-wrap bg-muted/30 rounded p-2">
                  {code}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground/50 mb-1">Output</div>
                <div className="text-xs text-muted-foreground/70 font-mono whitespace-pre-wrap bg-muted/30 rounded p-2">
                  {result}
                </div>
              </div>
            </div>
          )}
        </ChainItem>
      </div>
    );
  }

  // Fallback for unknown tools
  return (
    <div onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      <ChainItem
        icon={
          hasResult && isHovered ? (
            <ChevronRight
              className={cn(
                "h-3 w-3 text-muted-foreground transition-transform",
                !collapsed && "rotate-90"
              )}
            />
          ) : (
            <Hammer className="h-3 w-3 text-muted-foreground" />
          )
        }
        label={
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{name}</span>
            <span className="text-xs text-muted-foreground/50 font-mono">
              {Object.entries(args)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(", ")}
            </span>
          </div>
        }
        onIconClick={hasResult ? () => setCollapsed(!collapsed) : undefined}
        iconHoverable={hasResult}
      >
        {hasResult && !collapsed && (
          <div className="text-xs text-muted-foreground/70 font-mono whitespace-pre-wrap mt-1">
            {result}
          </div>
        )}
      </ChainItem>
    </div>
  );
}

function Markdown({ children }: { children: string }) {
  console.log("Markdown raw input:", JSON.stringify(children));
  // Fix model output quirks - but preserve math blocks and code blocks
  let content = children;

  // Split by math blocks ($$...$$) and inline math ($...$), code blocks to preserve them
  // Using a placeholder approach to protect special blocks
  const preserved: string[] = [];
  const placeholder = (i: number) => `\u0000PRESERVE${i}\u0000`;

  // Preserve $$ blocks, $ blocks, and ``` blocks
  content = content.replace(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$|```[\s\S]*?```)/g, (match) => {
    preserved.push(match);
    return placeholder(preserved.length - 1);
  });

  // Now safe to do text fixes on non-preserved content
  // Convert literal \n to actual newlines (model sometimes outputs escaped newlines)
  content = content.replace(/\\n/g, "\n");

  // Add newline after code fence language if missing (```rustuse -> ```rust\nuse)
  const knownLangsRegex =
    /(rust|python|py|javascript|js|typescript|ts|tsx|jsx|bash|sh|zsh|json|toml|yaml|yml|html|css|scss|sql|go|java|c|cpp|csharp|ruby|rb|php|swift|kotlin|scala|r|shell|text|plaintext|md|markdown|xml|diff)/i;

  // Add newlines before numbered lists, headers, bullet lists
  content = content.replace(/([^\n])(\d+)\.\s/g, "$1\n$2. ");
  content = content.replace(/([^\n])(#{1,6}\s)/g, "$1\n\n$2");
  content = content.replace(/([^\n])(-\s)/g, "$1\n$2");

  // Restore preserved blocks
  // eslint-disable-next-line no-control-regex
  content = content.replace(/\u0000PRESERVE(\d+)\u0000/g, (_, i) => {
    let block = preserved[parseInt(i)];
    // Convert literal \n to actual newlines inside preserved blocks too
    block = block.replace(/\\n/g, "\n");
    // Fix code fence language issue in restored code blocks
    if (block.startsWith("```")) {
      return block.replace(/```(\w+)/g, (match, lang) => {
        const langMatch = lang.match(knownLangsRegex);
        if (langMatch && langMatch[0] !== lang) {
          return "```" + langMatch[0] + "\n" + lang.slice(langMatch[0].length);
        }
        return match;
      });
    }
    return block;
  });
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        code({ className, children, node, ...props }) {
          console.log("Code block:", { className, content: String(children).slice(0, 50) });
          const codeString = String(children).replace(/\n$/, "");
          console.log("Code content:", JSON.stringify(codeString.slice(0, 200)));
          // Handle model not putting newline after language (e.g., className="language-rustuse" instead of "language-rust")
          const rawLang = className?.replace("language-", "") || "";
          const knownLangs =
            /^(rust|python|py|javascript|js|typescript|ts|tsx|jsx|bash|sh|zsh|json|toml|yaml|yml|html|css|scss|sql|go|java|c|cpp|csharp|ruby|rb|php|swift|kotlin|scala|r|shell|text|plaintext|md|markdown|xml|diff)/i;
          const langMatch = rawLang.match(knownLangs);
          const language = langMatch
            ? langMatch[1].toLowerCase()
            : rawLang.length > 0 && rawLang.length <= 12
            ? rawLang
            : null;

          // Check if it's a code block (has newlines) vs inline code
          const isBlock =
            node?.position?.start.line !== node?.position?.end.line || codeString.includes("\n");

          if (language || isBlock) {
            return (
              <SyntaxHighlighter
                style={catppuccinMocha}
                language={language || "text"}
                PreTag="div"
                className="rounded-lg my-3!"
                customStyle={{
                  overflow: "visible",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
                codeTagProps={{
                  style: {
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  },
                }}
              >
                {codeString}
              </SyntaxHighlighter>
            );
          }
          return (
            <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
              {children}
            </code>
          );
        },
        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-6 mb-3">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-6 mb-3">{children}</ol>,
        li: ({ children }) => <li className="mb-1">{children}</li>,
        h1: ({ children }) => <h1 className="text-xl font-bold mb-3 mt-4">{children}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-bold mb-2 mt-3">{children}</h2>,
        h3: ({ children }) => <h3 className="text-base font-semibold mb-2 mt-2">{children}</h3>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-muted-foreground/30 pl-4 italic text-muted-foreground mb-3">
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            className="text-primary underline hover:no-underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
        pre: ({ children }) => <>{children}</>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function App() {
  const [messages, setMessages] = useState<MessageItem[]>(() => {
    const saved = sessionStorage.getItem("chat-history");
    return saved ? JSON.parse(saved) : [];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeModel, setActiveModel] = useState<AvailableModels | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModels[]>([]);
  const [switching, setSwitching] = useState(true); // Start true to show loading immediately
  const [canToggleReasoning, setCanToggleReasoning] = useState(false);
  const [reasoningEnabled, setReasoningEnabled] = useState(false);
  const streamingRef = useRef("");
  const thinkingRef = useRef("");
  const isThinkingRef = useRef(false);
  const hasStartedResponseRef = useRef(false);

  const { scrollAreaRef, handleScroll } = useAutoScroll({ messages });

  useEffect(() => {
    const init = async () => {
      const models = await invoke<AvailableModels[]>("available_models");
      setAvailableModels(models);
      const current = await invoke<AvailableModels | null>("get_active_model");
      if (current) {
        setActiveModel(current);
        setSwitching(false);
      } else if (models.length > 0) {
        // No model loaded yet - trigger initial load
        try {
          await invoke("switch_model", { model: models[0] });
          setActiveModel(models[0]!);
        } finally {
          setSwitching(false);
        }
      }
    };
    init();
  }, []);

  // Persist chat history to sessionStorage (survives refresh, clears on app close)
  useEffect(() => {
    sessionStorage.setItem("chat-history", JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (!activeModel || switching) return;
    invoke<boolean>("can_toggle_reasoning").then(setCanToggleReasoning);
  }, [activeModel, switching]);

  useEffect(() => {
    const unlistenStart = listen("completion-start", () => {
      streamingRef.current = "";
      thinkingRef.current = "";
      isThinkingRef.current = false;
      hasStartedResponseRef.current = false;
    });

    const unlistenThinkingStart = listen("thinking-start", () => {
      isThinkingRef.current = true;
      thinkingRef.current = "";
      setMessages((m) => [...m, { type: "assistant", content: "", thinking: "" }]);
      hasStartedResponseRef.current = true;
    });

    const unlistenThinkingToken = listen<string>("thinking-token", (e) => {
      thinkingRef.current += e.payload;
      setMessages((m) => {
        const updated = [...m];
        const last = updated[updated.length - 1];
        if (last?.type === "assistant") {
          updated[updated.length - 1] = {
            type: "assistant",
            content: streamingRef.current,
            thinking: thinkingRef.current,
          };
        }
        return updated;
      });
    });

    const unlistenThinkingEnd = listen("thinking-end", () => {
      isThinkingRef.current = false;
    });

    const unlistenToken = listen<string>("token", (e) => {
      streamingRef.current += e.payload;

      if (!hasStartedResponseRef.current) {
        hasStartedResponseRef.current = true;
        setMessages((m) => [...m, { type: "assistant", content: streamingRef.current }]);
      } else {
        setMessages((m) => {
          const updated = [...m];
          const last = updated[updated.length - 1];
          if (last?.type === "assistant") {
            updated[updated.length - 1] = {
              type: "assistant",
              content: streamingRef.current,
              thinking: thinkingRef.current || undefined,
            };
          }
          return updated;
        });
      }
    });

    const unlistenToolCall = listen<[string, unknown]>("tool-call", (e) => {
      const [name, args] = e.payload;
      setMessages((m) => [...m, { type: "tool", name, args }]);
    });

    const unlistenToolResult = listen<string>("tool-result", (e) => {
      setMessages((m) => {
        // Find the last tool call and attach the result to it
        for (let i = m.length - 1; i >= 0; i--) {
          if (m[i].type === "tool") {
            const updated = [...m];
            updated[i] = { ...updated[i], result: e.payload } as MessageItem;
            return updated;
          }
        }
        return m;
      });
    });

    const unlistenEnd = listen("completion-end", () => {
      setLoading(false);
    });

    return () => {
      unlistenStart.then((f) => f());
      unlistenThinkingStart.then((f) => f());
      unlistenThinkingToken.then((f) => f());
      unlistenThinkingEnd.then((f) => f());
      unlistenToken.then((f) => f());
      unlistenToolCall.then((f) => f());
      unlistenToolResult.then((f) => f());
      unlistenEnd.then((f) => f());
    };
  }, []);

  function toApiMessages(msgs: MessageItem[]): Message[] {
    return msgs
      .filter(
        (m): m is { type: "user" | "assistant"; content: string } =>
          m.type === "user" || m.type === "assistant"
      )
      .map((m) => ({ role: m.type, content: m.content }));
  }

  async function send() {
    if (!input.trim() || loading) return;

    const newMessages: MessageItem[] = [...messages, { type: "user", content: input }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      await invoke("completion", { messages: toApiMessages(newMessages) });
    } catch (e) {
      setMessages((m) => [...m, { type: "assistant", content: `Error: ${e}` }]);
      setLoading(false);
    }
  }

  async function switchModel(model: AvailableModels) {
    if (switching || loading) return;
    setSwitching(true);
    setCanToggleReasoning(false);
    try {
      await invoke("switch_model", { model });
      setActiveModel(model);
    } catch (e) {
      console.error("Failed to switch model:", e);
    } finally {
      setSwitching(false);
    }
  }

  async function toggleReasoning() {
    const newValue = !reasoningEnabled;
    try {
      await invoke("set_reasoning", { reasoning: newValue });
      setReasoningEnabled(newValue);
    } catch (e) {
      console.error("Failed to toggle reasoning:", e);
    }
  }

  return (
    <main className="flex h-screen flex-col bg-background overflow-hidden relative">
      <header className="flex items-center bg-card select-none relative">
        <div className="absolute inset-0 z-0" data-tauri-drag-region />
        <div className="flex-1 flex items-center gap-2 px-3 py-1.5 pointer-events-none">
          <img src="/logo.png" alt="Flint" className="h-4 w-4" />
          <span className="text-xs font-medium text-muted-foreground">Flint</span>
        </div>
        <div className="flex items-center text-muted-foreground z-10">
          <button
            onClick={() => getCurrentWindow().minimize()}
            className="w-12 h-9 flex items-center justify-center hover:bg-muted/50 transition-colors"
            title="Minimize"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
              <path fill="currentColor" d="M19 13H5v-2h14z" />
            </svg>
          </button>
          <button
            onClick={() => getCurrentWindow().toggleMaximize()}
            className="w-12 h-9 flex items-center justify-center hover:bg-muted/50 transition-colors"
            title="Maximize"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
              <path fill="currentColor" d="M4 4h16v16H4zm2 4v10h12V8z" />
            </svg>
          </button>
          <button
            onClick={() => getCurrentWindow().close()}
            className="w-12 h-9 flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground transition-colors"
            title="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12z"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Loading state when model is loading */}
      {switching && !activeModel ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Flint" className="h-12 w-12" />
            <span className="text-2xl font-semibold text-foreground">Flint</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
            <div className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
            <div className="h-1.5 w-1.5 rounded-full bg-current animate-bounce" />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 relative">
          {/* Toolbar - positioned within content area */}
          <div className="absolute top-0 left-0 right-0 z-10 flex justify-end px-4 py-2 pointer-events-none">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setMessages([])}
              className="rounded-lg text-muted-foreground pointer-events-auto"
              title="New chat"
            >
              <MessageSquarePlus className="h-5 w-5" />
            </Button>
          </div>

          <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0" onScrollCapture={handleScroll}>
            <div className="max-w-3xl mx-auto px-8 pt-12 pb-4 space-y-2">
              {(() => {
                const rendered: React.ReactNode[] = [];
                let chainItems: React.ReactNode[] = [];
                let chainKey = 0;

                const flushChain = () => {
                  if (chainItems.length > 0) {
                    rendered.push(
                      <div key={`chain-${chainKey}`} className="max-w-[80%] py-2">
                        <ChainWrapper>{chainItems}</ChainWrapper>
                      </div>
                    );
                    chainKey++;
                    chainItems = [];
                  }
                };

                messages.forEach((m, i) => {
                  const nextMsg = messages[i + 1];

                  if (m.type === "tool") {
                    const args = m.args as Record<string, unknown>;
                    chainItems.push(
                      <ToolCallBlock key={i} name={m.name} args={args} result={m.result} />
                    );
                    return;
                  }

                  if (m.type === "user") {
                    flushChain();
                    rendered.push(
                      <div
                        key={i}
                        className="w-fit max-w-[80%] ml-auto rounded-2xl px-4 py-3 text-sm leading-relaxed bg-primary text-primary-foreground my-6"
                      >
                        {m.content}
                      </div>
                    );
                    return;
                  }

                  // Assistant message
                  if (m.thinking) {
                    const isComplete = !!m.content || nextMsg?.type === "tool";
                    chainItems.push(
                      <ThinkingBlock
                        key={`think-${i}`}
                        content={m.thinking}
                        isComplete={isComplete}
                      />
                    );
                  }

                  if (m.content) {
                    flushChain();
                    rendered.push(
                      <div key={i} className="my-2 text-sm leading-relaxed text-foreground">
                        <Markdown>{m.content}</Markdown>
                      </div>
                    );
                  }
                });

                flushChain();
                return rendered;
              })()}
              <div className="h-36" />
            </div>
          </ScrollArea>

          {/* Gradient fade */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-linear-to-t from-background to-transparent pointer-events-none" />

          {/* Floating chat input */}
          <div className="absolute bottom-0 left-0 right-0 p-6 pt-0 pointer-events-none">
            <div className="max-w-2xl mx-auto pointer-events-auto">
              <div className="bg-card/95 backdrop-blur-sm border border-border/60 rounded-3xl shadow-2xl shadow-black/20">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                >
                  <div className="px-4 pt-4 pb-2">
                    <Textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !loading) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      placeholder="Ask something..."
                      className="min-h-0! text-sm! py-1.5 border-0 bg-transparent focus-visible:ring-0 focus-visible:border-transparent rounded-none"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-0">
                    <div className="flex items-center gap-2">
                      <Select
                        value={activeModel ?? undefined}
                        onValueChange={(v) => switchModel(v as AvailableModels)}
                        disabled={switching || loading || !activeModel}
                      >
                        <SelectTrigger
                          size="sm"
                          className="text-xs text-muted-foreground border-0 bg-muted/50 hover:bg-muted rounded-lg gap-1.5 px-2.5 w-auto"
                        >
                          <SelectValue>
                            {switching
                              ? "Loading..."
                              : activeModel
                              ? MODEL_LABELS[activeModel]
                              : "..."}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {availableModels.map((m) => (
                            <SelectItem key={m} value={m}>
                              {MODEL_LABELS[m] || m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {canToggleReasoning && (
                        <Button
                          type="button"
                          variant={reasoningEnabled ? "secondary" : "ghost"}
                          size="icon-sm"
                          onClick={toggleReasoning}
                          disabled={loading || switching}
                          className={cn(
                            "rounded-lg h-8 w-8 text-muted-foreground",
                            reasoningEnabled &&
                              "bg-primary/15 text-primary/75 hover:bg-primary/25 hover:text-primary"
                          )}
                        >
                          <Brain className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <Button
                      type="submit"
                      size="icon"
                      disabled={loading || switching || !input.trim()}
                      className={"shrink-0 rounded-full"}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 19V5M5 12l7-7 7 7" />
                      </svg>
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
