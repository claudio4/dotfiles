import { which } from "internal/cmd";
import { BaseTask, getTask, isTaskRegistered, TaskStatus } from "internal/task";
import { compileTemplateFromFile } from "internal/template";
import { getConfigHome, getHome } from "internal/user";
import { isWSL } from "internal/utils";
import { join } from "node:path";

class BashTask extends BaseTask {
  override id = "bash";
  options = {
    /** Wether to redirect interactive sessions to FISH shell if present */
    interactiveToFish: true,
  };
  override async _execute(): Promise<void> {
    const vars: {
      configHome: string;
      fish?: string;
      homebrew?: string;
      wsl: boolean;
    } = {
      configHome: getConfigHome(),
      wsl: isWSL(),
    };
    if (this.options.interactiveToFish) {
      const fishPath = which("fish");
      if (fishPath) {
        vars.fish = fishPath;
      }
    }

    const homebrew = await getTask("homebrew");
    if (homebrew && homebrew.getInfo().status !== TaskStatus.Unregistered) {
      vars.homebrew = homebrew.options!.homebrewPath;
    }
    this.setMessage("Create .bashrc");
    const bashrc = (await compileTemplateFromFile(join(import.meta.dir, "bashrc.tmpl")))(vars);
    await Bun.file(join(getHome(), ".bashrc")).write(bashrc);
  }
}

export default new BashTask();
