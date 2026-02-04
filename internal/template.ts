import { dirname } from "node:path";
import { mkdir } from "./fs";

/**
 * Compiles a template string into an executable function.
 *
 * Template syntax:
 * - `{%! code %}`: Logic block - executes arbitrary code (e.g., loops, conditionals)
 * - `{% expression %}`: Output block - evaluates expression and appends to output
 * - Plain text: Appended to output as-is
 *
 * Logic blocks that are alone on a line (with only whitespace) will consume their line break.
 *
 * @param template - Template string to compile
 * @returns Function that accepts context object `$` and returns rendered string
 *
 * @example
 * const fn = compileTemplate("Hello {% $.name %}!");
 * fn({ name: "World" }); // "Hello World!"
 *
 * @example
 * const fn = compileTemplate("{%! for (const item of $.items) { %}{% item %}{%! } %}");
 * fn({ items: [1, 2, 3] }); // "123"
 */
export function compileTemplate(template: string): (context: any) => string {
  // Split by: 1. Closing tag, 2. Logic tag ({%!), 3. Output tag ({%)
  // Order matters: '{%!' must come before '{%' in regex
  const parts = template.split(/(%\}|\{%!|\{%)/);

  let body = 'let out = "";\n';
  let mode = "text";
  let previousTextPart = "";
  let isStandaloneLogicBlock = false;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part === "{%!") {
      // Check if the previous text part makes this logic block "standalone"
      // (i.e., only whitespace from the last newline to this tag)
      const lastNewlineIndex = previousTextPart.lastIndexOf("\n");
      if (lastNewlineIndex === -1) {
        // No newline yet - check if we're at the start and only have whitespace
        isStandaloneLogicBlock = previousTextPart.trim() === "";
      } else {
        // Check if everything after the last newline is whitespace
        const afterNewline = previousTextPart.slice(lastNewlineIndex + 1);
        isStandaloneLogicBlock = afterNewline.trim() === "";
      }
      mode = "logic";
      continue;
    }

    if (part === "{%") {
      mode = "output";
      isStandaloneLogicBlock = false; // Output blocks don't consume newlines
      continue;
    }

    if (part === "%}") {
      // If this was a standalone logic block, check if next part starts with whitespace + newline
      if (mode === "logic" && isStandaloneLogicBlock && i + 1 < parts.length) {
        const nextPart = parts[i + 1];
        // Check if next part starts with optional whitespace followed by newline
        const match = nextPart.match(/^[ \t]*\r?\n/);
        if (match) {
          // Strip the matched whitespace and newline from the next part
          parts[i + 1] = nextPart.slice(match[0].length);
        }
      }
      mode = "text";
      isStandaloneLogicBlock = false;
      continue;
    }

    if (mode === "text") {
      // Standard text: append as string
      if (part) body += `out += ${JSON.stringify(part)};\n`;
      previousTextPart = part;
    } else if (mode === "output") {
      // Output: append evaluated result
      body += `out += (${part});\n`;
    } else if (mode === "logic") {
      // Logic: execute raw code
      body += `${part}\n`;
    }
  }

  body += "return out;";
  return new Function("$", body);
}

/**
 * Loads and compiles a template from a file.
 *
 * @param path - File system path to template file
 * @returns Promise resolving to compiled template function
 */
export function compileTemplateFromFile(path: string): Promise<(context: any) => string> {
  return Bun.file(path)
    .text()
    .then((t) => compileTemplate(t));
}

export interface RenderTemplateResult {
  /**
   * True if the destination file was modified or created
   */
  changed: boolean;

  /**
   * True if the destination file was created (did not exist before)
   */
  created: boolean;
}

/**
 * Renders a template file to a destination file.
 * Creates parent directories as needed.
 * Only writes the file if the content has changed (idempotent).
 *
 * @param templatePath - Path to the template file
 * @param destinationPath - Path where the rendered output should be saved
 * @param context - Context object (available as `$` in the template)
 * @returns Promise resolving to result indicating if anything changed
 *
 */
export async function renderTemplateToFile(
  templatePath: string,
  destinationPath: string,
  context: any = {},
): Promise<RenderTemplateResult> {
  const result: RenderTemplateResult = {
    changed: false,
    created: false,
  };

  const compiledTemplate = await compileTemplateFromFile(templatePath);
  const renderedContent = compiledTemplate(context);

  const destFile = Bun.file(destinationPath);

  if (await destFile.exists()) {
    const existingContent = await destFile.text();
    if (existingContent === renderedContent) {
      // Content is the same, no changes needed
      return result;
    }
  } else {
    result.created = true;
  }

  const parentDir = dirname(destinationPath);
  await mkdir(parentDir);

  await destFile.write(renderedContent);
  result.changed = true;

  return result;
}
