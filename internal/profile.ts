import type { Task, TaskStatusListener } from "./task";

export interface ProfileConfig<O> {
  name: string;
  description?: string;
  options?: O;
}

export class Profile<O = undefined> {
  readonly name: string;
  readonly description?: string;
  tasks: Task[];
  options?: O;

  constructor(config: ProfileConfig<O>) {
    this.name = config.name;
    this.description = config.description;
    this.tasks = [];
    this.options = config.options;
  }

  /**
   * Adds one or more tasks to the Profile.
   * returns iteslf to allow chaining
   * @param task The task to add.
   */
  addTask(...task: Task[]): this {
    this.tasks.push(...task);
    return this;
  }

  /**
   * Registers all tasks in the Profile.
   * returns iteslf to allow chaining
   */
  register(): this {
    for (const task of this.tasks) {
      task.register();
    }
    return this;
  }

  /**
   * Adds a listener to all tasks in the Profile.
   * returns iteslf to allow chaining
   */
  addTaskStatusListener(listener: TaskStatusListener): this {
    for (const task of this.tasks) {
      task.addStatusListener(listener);
    }
    return this;
  }
}
