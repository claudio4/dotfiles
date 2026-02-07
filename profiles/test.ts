import { Profile } from "internal/profile";
import vim from "tasks/vim/vim";

const profile = new Profile({
  name: "Test Profile",
});

profile.addTask(vim);

export default profile;
