import { Profile } from "internal/profile";
import bash from "tasks/bash/bash";
import basicTools from "tasks/basic-tools/basic-tools";
import buildEssentials from "tasks/build-essentials/build-essentials";
import fish from "tasks/fish/fish";
import git from "tasks/git/git";
import go from "tasks/go/go";
import homebrew from "tasks/homebrew/homebrew";
import modernUtils from "tasks/modern-utils/modern-utils";
import neovim from "tasks/neovim/neovim";
import tmux from "tasks/tmux/tmux";
import wsl from "tasks/wsl/wsl";

const profile = new Profile({
  name: "Workstation",
  description: "The basic profile of my workstations",
});

profile.addTask(git, homebrew, buildEssentials, bash, basicTools, fish, go, neovim, modernUtils, tmux, wsl);

export default profile;
