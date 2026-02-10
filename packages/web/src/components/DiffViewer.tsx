"use client";

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  oldNum?: number;
  newNum?: number;
}

function parseDiff(diff: string): DiffLine[] {
  const lines = diff.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      // Parse hunk header like @@ -10,6 +10,8 @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: "header", content: line });
    } else if (line.startsWith("---") || line.startsWith("+++")) {
      result.push({ type: "header", content: line });
    } else if (line.startsWith("diff ")) {
      result.push({ type: "header", content: line });
    } else if (line.startsWith("+")) {
      result.push({ type: "add", content: line.slice(1), newNum: newLine });
      newLine++;
    } else if (line.startsWith("-")) {
      result.push({ type: "remove", content: line.slice(1), oldNum: oldLine });
      oldLine++;
    } else {
      // Context line (may start with space)
      const content = line.startsWith(" ") ? line.slice(1) : line;
      if (line.length > 0 || result.length > 0) {
        result.push({ type: "context", content, oldNum: oldLine, newNum: newLine });
        oldLine++;
        newLine++;
      }
    }
  }

  return result;
}

export function DiffViewer({ diff }: { diff: string }) {
  const lines = parseDiff(diff);

  if (lines.length === 0) {
    return (
      <div className="rounded bg-surface-2 p-3 text-xs text-muted font-mono">
        Empty diff
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs font-mono" style={{ borderCollapse: "collapse" }}>
        <tbody>
          {lines.map((line, i) => {
            if (line.type === "header") {
              return (
                <tr key={i} className="bg-accent/8">
                  <td className="select-none px-2 py-0 text-right text-muted/50 w-10" />
                  <td className="select-none px-2 py-0 text-right text-muted/50 w-10" />
                  <td className="px-3 py-0.5 text-accent/70">{line.content}</td>
                </tr>
              );
            }

            const bgClass =
              line.type === "add"
                ? "bg-green/8"
                : line.type === "remove"
                  ? "bg-red/8"
                  : "";

            const textClass =
              line.type === "add"
                ? "text-green"
                : line.type === "remove"
                  ? "text-red"
                  : "text-foreground/70";

            const prefix =
              line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";

            return (
              <tr key={i} className={bgClass}>
                <td className="select-none border-r border-border/50 px-2 py-0 text-right text-muted/40 w-10">
                  {line.oldNum ?? ""}
                </td>
                <td className="select-none border-r border-border/50 px-2 py-0 text-right text-muted/40 w-10">
                  {line.newNum ?? ""}
                </td>
                <td className={`px-3 py-0 whitespace-pre ${textClass}`}>
                  <span className="select-none text-muted/30 mr-1">{prefix}</span>
                  {line.content}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
