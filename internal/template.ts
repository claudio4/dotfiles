/**
 * Compiles a template string into an executable function.
 *
 * Template syntax:
 * - `{%! code %}`: Logic block - executes arbitrary code (e.g., loops, conditionals)
 * - `{% expression %}`: Output block - evaluates expression and appends to output
 * - Plain text: Appended to output as-is
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

  for (const part of parts) {
    if (part === "{%!") {
      mode = "logic";
      continue;
    }
    if (part === "{%") {
      mode = "output";
      continue;
    }
    if (part === "%}") {
      mode = "text";
      continue;
    }

    if (mode === "text") {
      // Standard text: append as string
      if (part) body += `out += ${JSON.stringify(part)};\n`;
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
