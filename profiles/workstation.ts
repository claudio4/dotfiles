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
import rust from "tasks/rust/rust";
import tmux from "tasks/tmux/tmux";
import wsl from "tasks/wsl/wsl";
import zsh from "tasks/zsh/zsh";

const profile = new Profile({
  name: "Workstation",
  description: "The basic profile of my workstations",
});

profile.addTask(git, homebrew, buildEssentials, bash, basicTools, fish, go, rust, neovim, modernUtils, tmux, zsh, wsl);

export default profile;
