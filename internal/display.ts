import type { Profile } from "./profile";
import type { TaskStatus, TaskStatusInfo } from "./task";

/**
 * ANSI escape codes for terminal control
 */
const ANSI = {
  // Cursor control
  HIDE_CURSOR: "\x1b[?25l",
  SHOW_CURSOR: "\x1b[?25h",
  CLEAR_SCREEN: "\x1b[2J",
  MOVE_TO_TOP: "\x1b[H",
  CLEAR_LINE: "\x1b[2K",
  MOVE_UP: (lines: number) => `\x1b[${lines}A`,
  MOVE_DOWN: (lines: number) => `\x1b[${lines}B`,

  // Colors
  RESET: "\x1b[0m",
  BOLD: "\x1b[1m",
  DIM: "\x1b[2m",

  // Foreground colors
  BLACK: "\x1b[30m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
  CYAN: "\x1b[36m",
  WHITE: "\x1b[37m",
  GRAY: "\x1b[90m",

  // Background colors
  BG_RED: "\x1b[41m",
  BG_GREEN: "\x1b[42m",
  BG_YELLOW: "\x1b[43m",
  BG_BLUE: "\x1b[44m",
} as const;

/**
 * Emoji and color mapping for each task status
 */
const STATUS_DISPLAY = {
  unregistered: { emoji: "⚫", color: ANSI.GRAY, label: "Unregistered" },
  pending: { emoji: "⏸️", color: ANSI.WHITE, label: "Pending" },
  waiting: { emoji: "⏳", color: ANSI.YELLOW, label: "Waiting" },
  running: { emoji: "🚀", color: ANSI.CYAN, label: "Running" },
  completed: { emoji: "✅", color: ANSI.GREEN, label: "Completed" },
  skipped: { emoji: "⏭️", color: ANSI.DIM + ANSI.YELLOW, label: "Skipped" },
  failed: { emoji: "❌", color: ANSI.RED, label: "Failed" },
} as const;

/**
 * Priority order for sorting tasks (lower number = higher priority/more interesting)
 */
const STATUS_PRIORITY: Record<TaskStatus, number> = {
  failed: 0,
  running: 1,
  waiting: 2,
  pending: 3,
  completed: 4,
  skipped: 5,
  unregistered: 6,
};

/**
 * Options for the display
 */
export interface DisplayOptions {
  /** Whether to use colors and emojis (default: true) */
  fancy?: boolean;
  /** Maximum width for task IDs before truncation (default: 40) */
  maxTaskIdWidth?: number;
}

/**
 * Pretty terminal display for profile execution
 */
export class ProfileDisplay {
  private profile: Profile;
  private options: Required<DisplayOptions>;
  private taskInfoMap: Map<string, TaskStatusInfo> = new Map();
  private linesDrawn: number = 0;
  private isActive: boolean = false;
  private startTime: number = 0;
  private terminalWidth: number;
  private resizeHandler: (() => void) | null = null;
  private redrawTimer: Timer | null = null;
  private pendingRedraw: boolean = false;

  constructor(profile: Profile, options: DisplayOptions = {}) {
    this.profile = profile;
    this.options = {
      fancy: options.fancy ?? true,
      maxTaskIdWidth: options.maxTaskIdWidth ?? 40,
    };
    // Get terminal width, fallback to the standard 80 characters if not available
    this.terminalWidth = process.stdout.columns || 80;
  }

  /**
   * Start displaying the profile execution
   */
  start(): void {
    if (this.isActive) return;

    this.isActive = true;
    this.startTime = Date.now();

    // Hide cursor for cleaner output
    if (this.options.fancy) {
      process.stdout.write(ANSI.HIDE_CURSOR);
      this.redrawTimer = setImmediate(() => {
        if (this.isActive) {
          this.draw();
        }
      }, 1000);
    }

    process.stdout.on("resize", this.handleResize);
    this.terminalWidth = process.stdout.columns || this.terminalWidth;

    // Initialize task info
    for (const task of this.profile.tasks) {
      this.taskInfoMap.set(task.id, task.getInfo());
    }

    // Draw initial screen
    this.draw();

    // Setup cleanup on exit
    process.on("exit", () => this.cleanup());
    process.on("SIGINT", () => {
      this.cleanup();
      process.exit(130);
    });
  }

  handleResize = () => {
    this.terminalWidth = process.stdout.columns || 80;
    if (this.isActive) this.scheduleDraw();
  };

  /**
   * Handle task status updates
   */
  handleStatusUpdate = (info: TaskStatusInfo): void => {
    this.taskInfoMap.set(info.id, info);
    if (this.isActive) {
      this.scheduleDraw();
    }
  };

  /**
   * Schedule a draw to happen after current microtask queue is finished
   * This debounces multiple rapid updates into a single redraw
   */
  private scheduleDraw(): void {
    if (this.pendingRedraw) return;

    this.pendingRedraw = true;
    queueMicrotask(() => {
      this.pendingRedraw = false;
      if (this.isActive) {
        this.draw();
      }
    });
  }

  /**
   * Finish displaying and show final report
   */
  finish(): void {
    if (!this.isActive) return;

    this.isActive = false;
    this.draw();
    this.drawFinalReport();
    this.cleanup();
  }

  /**
   * Clean up terminal state
   */
  private cleanup(): void {
    if (this.options.fancy) {
      process.stdout.write(ANSI.SHOW_CURSOR);
    }
    if (this.redrawTimer) {
      clearTimeout(this.redrawTimer);
      this.redrawTimer = null;
    }
    process.stdout.off("resize", this.handleResize);
  }

  /**
   * Draw the current state to the terminal
   */
  private draw(): void {
    // Clear previous output
    if (this.linesDrawn > 0) {
      process.stdout.write(ANSI.MOVE_UP(this.linesDrawn));
    }

    let output = "";
    let lines = 0;

    // Draw header
    const headerLines = this.drawHeader();
    for (const line of headerLines) {
      const result = this.clearAndWriteLine(line);
      output += result.output;
      lines += result.lines;
    }

    // Empty line
    output += ANSI.CLEAR_LINE + "\n";
    lines += 1;

    // Draw tasks
    const taskLines = this.drawTasks();
    for (const line of taskLines) {
      const result = this.clearAndWriteLine(line);
      output += result.output;
      lines += result.lines;
    }

    this.linesDrawn = lines;
    process.stdout.write(output);
  }

  /**
   * Draw the profile header
   */
  private drawHeader(): string[] {
    const lines: string[] = [];

    const separatorWidth = Math.min(60, this.terminalWidth);

    if (this.options.fancy) {
      lines.push(ANSI.CLEAR_LINE + ANSI.BOLD + ANSI.CYAN + "═".repeat(separatorWidth) + ANSI.RESET);
      lines.push(
        ANSI.CLEAR_LINE + ANSI.BOLD + ANSI.CYAN + "  📋 Profile: " + ANSI.WHITE + this.profile.name + ANSI.RESET,
      );
      if (this.profile.description) {
        lines.push(ANSI.CLEAR_LINE + ANSI.GRAY + "  " + this.profile.description + ANSI.RESET);
      }
      lines.push(ANSI.CLEAR_LINE + ANSI.BOLD + ANSI.CYAN + "═".repeat(separatorWidth) + ANSI.RESET);
    } else {
      lines.push(ANSI.CLEAR_LINE + `Profile: ${this.profile.name}`);
      if (this.profile.description) {
        lines.push(ANSI.CLEAR_LINE + `  ${this.profile.description}`);
      }
      lines.push(ANSI.CLEAR_LINE + "-".repeat(separatorWidth));
    }

    return lines;
  }

  /**
   * Draw all tasks sorted by status priority
   */
  private drawTasks(): string[] {
    const lines: string[] = [];

    // Get and sort tasks (reverse priority so most important are at the bottom)
    const sortedTasks = Array.from(this.taskInfoMap.values()).sort((a, b) => {
      const priorityDiff = STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status];
      if (priorityDiff !== 0) return priorityDiff;
      // Secondary sort by ID for stability
      return a.id.localeCompare(b.id);
    });

    // Draw each task
    for (const info of sortedTasks) {
      lines.push(this.drawTask(info));
    }

    return lines;
  }

  /**
   * Draw a single task
   */
  private drawTask(info: TaskStatusInfo): string {
    const display = STATUS_DISPLAY[info.status];
    let line = ANSI.CLEAR_LINE;

    if (this.options.fancy) {
      // Emoji and colored status
      line += `  ${display.emoji}  ${display.color}`;
    }

    // Task ID (truncated if needed)
    let taskId = info.id;
    if (taskId.length > this.options.maxTaskIdWidth) {
      taskId = taskId.substring(0, this.options.maxTaskIdWidth - 3) + "...";
    }

    line += taskId.padEnd(this.options.maxTaskIdWidth);

    if (this.options.fancy) {
      line += ANSI.RESET;
    }

    // Duration (if applicable)
    if (info.startTime) {
      const endTime = info.endTime || Date.now();
      const duration = endTime - info.startTime;
      line += ANSI.GRAY + ` (${this.formatDuration(duration)})` + ANSI.RESET;
    }

    // Message (if any)
    if (info.message) {
      line += ANSI.DIM + ` - ${info.message}` + ANSI.RESET;
    }

    // Skip reason (if applicable)
    if (info.skipReason) {
      line += ANSI.YELLOW + ` - ${this.formatSkipReason(info.skipReason)}` + ANSI.RESET;
    }

    // Error (if applicable)
    if (info.error) {
      const errorMsg = info.error.message.split("\n")[0]; // First line only
      line += ANSI.RED + ` - ${errorMsg}` + ANSI.RESET;
    }

    return line;
  }

  /**
   * Draw the final report after execution
   */
  private drawFinalReport(): void {
    const totalDuration = Date.now() - this.startTime;

    // Count statuses
    const counts = {
      completed: 0,
      failed: 0,
      skipped: 0,
      total: this.taskInfoMap.size,
    };

    for (const info of this.taskInfoMap.values()) {
      if (info.status === "completed") counts.completed++;
      else if (info.status === "failed") counts.failed++;
      else if (info.status === "skipped") counts.skipped++;
    }

    const lines: string[] = [];
    lines.push("");

    if (this.options.fancy) {
      lines.push(ANSI.BOLD + ANSI.CYAN + "═".repeat(60) + ANSI.RESET);
      lines.push(ANSI.BOLD + ANSI.CYAN + "  📊 Execution Report" + ANSI.RESET);
      lines.push(ANSI.BOLD + ANSI.CYAN + "═".repeat(60) + ANSI.RESET);
      lines.push("");

      // Summary stats
      lines.push(ANSI.BOLD + "  Summary:" + ANSI.RESET);
      lines.push(`    ${ANSI.GREEN}✅ Completed:${ANSI.RESET} ${counts.completed}/${counts.total}`);
      if (counts.failed > 0) {
        lines.push(`    ${ANSI.RED}❌ Failed:${ANSI.RESET}    ${counts.failed}/${counts.total}`);
      }
      if (counts.skipped > 0) {
        lines.push(`    ${ANSI.YELLOW}⊘  Skipped:${ANSI.RESET}   ${counts.skipped}/${counts.total}`);
      }
      lines.push("");
      lines.push(`    ${ANSI.CYAN}⏱️  Total time:${ANSI.RESET} ${this.formatDuration(totalDuration)}`);
      lines.push("");

      // Overall result
      if (counts.failed > 0) {
        lines.push(ANSI.BOLD + ANSI.BG_RED + ANSI.WHITE + "  ❌ PROFILE FAILED  " + ANSI.RESET);
      } else if (counts.completed === counts.total) {
        lines.push(ANSI.BOLD + ANSI.BG_GREEN + ANSI.WHITE + "  ✅ PROFILE COMPLETED SUCCESSFULLY  " + ANSI.RESET);
      } else {
        lines.push(ANSI.BOLD + ANSI.BG_YELLOW + ANSI.BLACK + "  ⚠️  PROFILE COMPLETED WITH WARNINGS  " + ANSI.RESET);
      }

      lines.push(ANSI.BOLD + ANSI.CYAN + "═".repeat(60) + ANSI.RESET);
    } else {
      lines.push("-".repeat(60));
      lines.push("Execution Report");
      lines.push("-".repeat(60));
      lines.push("");
      lines.push("Summary:");
      lines.push(`  Completed: ${counts.completed}/${counts.total}`);
      if (counts.failed > 0) {
        lines.push(`  Failed:    ${counts.failed}/${counts.total}`);
      }
      if (counts.skipped > 0) {
        lines.push(`  Skipped:   ${counts.skipped}/${counts.total}`);
      }
      lines.push("");
      lines.push(`  Total time: ${this.formatDuration(totalDuration)}`);
      lines.push("");

      if (counts.failed > 0) {
        lines.push("PROFILE FAILED");
      } else if (counts.completed === counts.total) {
        lines.push("PROFILE COMPLETED SUCCESSFULLY");
      } else {
        lines.push("PROFILE COMPLETED WITH WARNINGS");
      }

      lines.push("-".repeat(60));
    }

    process.stdout.write(lines.join("\n") + "\n");
  }

  /**
   * Clear all lines that text will occupy and prepare output string
   * @returns Object with the output string and number of actual lines
   */
  private clearAndWriteLine(line: string): { output: string; lines: number } {
    const actualLines = this.countActualLines(line);
    let output = "";

    // Clear all lines this text will occupy
    for (let i = 0; i < actualLines; i++) {
      output += ANSI.CLEAR_LINE + (i < actualLines - 1 ? "\n" : "");
    }

    // Move back up to write the actual content
    if (actualLines > 1) {
      output += ANSI.MOVE_UP(actualLines - 1);
    }

    output += "\r" + line + "\n";

    return { output, lines: actualLines };
  }

  /**
   * Count how many actual terminal lines a string will take up,
   * accounting for text wrapping and ANSI codes
   */
  private countActualLines(text: string): number {
    // Strip ANSI escape codes to get the actual visible text length
    const visibleText = this.stripAnsi(text);

    if (visibleText.length === 0) return 1;

    // Calculate how many lines this text will wrap to
    return Math.ceil(visibleText.length / this.terminalWidth);
  }

  /**
   * Strip ANSI escape codes from a string to get visible length
   */
  private stripAnsi(text: string): string {
    // Regex to match ANSI escape codes
    return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
  }

  /**
   * Format duration in a human-readable way
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      const seconds = Math.floor(ms / 1000);
      return `${seconds.toString().padStart(2, "0")}s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
    }
  }

  /**
   * Format skip reason in a human-readable way
   */
  private formatSkipReason(reason: TaskStatusInfo["skipReason"]): string {
    if (!reason) return "Unknown reason";

    switch (reason.type) {
      case "dependency-not-registered":
        return `Dependency not registered: ${reason.dependency}`;
      case "dependency-failed":
        return `Dependency failed: ${reason.dependency}`;
      case "explicit":
        return reason.reason;
      case "condition-not-met":
        return `Condition not met: ${reason.reason}`;
      default:
        return "Unknown reason";
    }
  }
}

/**
 * Helper function to create and start a display for a profile
 */
export function createProfileDisplay(profile: Profile, options?: DisplayOptions): ProfileDisplay {
  const display = new ProfileDisplay(profile, options);

  // Add listener to all tasks
  profile.addTaskStatusListener(display.handleStatusUpdate);

  return display;
}

/**
 * Helper function to run a profile with display
 */
export async function runProfileWithDisplay(profile: Profile, options?: DisplayOptions): Promise<void> {
  const display = createProfileDisplay(profile, options);

  display.start();

  try {
    // Run all tasks concurrently
    await Promise.allSettled(profile.tasks.map((task) => task.run()));
  } finally {
    display.finish();
  }
}
