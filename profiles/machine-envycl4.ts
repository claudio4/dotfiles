import { Profile } from "internal/profile";
import { getDistroFamily } from "internal/utils";
import bash from "tasks/bash/bash";
import basicTools from "tasks/basic-tools/basic-tools";
import braveBrowser from "tasks/brave-browser/brave-browser";
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
import zed from "tasks/zed/zed";
import zsh from "tasks/zsh/zsh";

const profile = new Profile({
  name: "EnvyCl4",
  description: "Profile for my Linux Laptop",
});

// Arch has all package I need in its repos and by using those we avoid having to compile
//  some  homebrew packages.
homebrew.options.shouldOverride = (await getDistroFamily()) !== "arch";

// We use fish instead
zsh.options.setDefaultShell = false;

profile.addTask(
  git,
  homebrew,
  buildEssentials,
  bash,
  basicTools,
  fish,
  go,
  neovim,
  zed,
  modernUtils,
  tmux,
  zsh,
  braveBrowser,
);

export default profile;
