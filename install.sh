#!/bin/bash

# Exit on error, treat unset variables as an error, and ensure pipelines fail on the first error
set -euo pipefail

# --- Configuration ---
ANSIBLE_REPO_URL="https://github.com/claudio4/dotfiles.git"

# --- Script Variables ---
MACHINE_TYPE=""
SKIP_TAGS=""
PLAYBOOK_FILE=""
INTERACTIVE_MODE=true         # Will be determined dynamically
SKIP_DEPS=false               # Default: do not skip dependency installation
RUNNING_FROM_LOCAL_REPO=false # Default: assume running via ansible-pull
FORCE_REMOTE=false            # Default: do not force remote installation
SCRIPT_DIR=""                 # Will be set to the script's directory

# OS-specific package manager commands (will be populated by detect_os_and_package_manager)
PKG_MANAGER=""
PRE_INSTALL_CMDS=()
INSTALL_CMD_BASE=()

# --- Helper Functions ---
log() {
    echo "[INFO] $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

warn() {
    echo "[WARN] $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
}

error() {
    echo "[ERROR] $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
    exit 1
}

print_usage() {
    echo "Usage: $0 [options]"
    echo
    echo "Automates the installation of dotfiles from ${ANSIBLE_REPO_URL} via Ansible."
    echo
    echo "Options:"
    echo "  --type <server|workstation>  Specify the machine type. Determines playbook (server.yml or workstation.yml)."
    echo "                               Overrides DOTFILES_TYPE environment variable."
    echo "  --skip-tags <tag1,tag2>      Comma-separated list of Ansible tags to skip."
    echo "                               Overrides DOTFILES_SKIP_TAGS environment variable."
    echo "  --skip-deps                  If set, skip automatic dependency installation. If dependencies are missing,"
    echo "                               the script will show an error and exit."
    echo "                               Overrides DOTFILES_SKIP_DEPS environment variable."
    echo "  --non-interactive            Disable all interactive prompts. Configuration must be"
    echo "                               fully provided via arguments or environment variables."
    echo "                               Overrides NON_INTERACTIVE environment variable."
    echo "  -h, --help                   Show this help message."
    echo
    echo "Environment Variables:"
    echo "  DOTFILES_TYPE:               Machine type (server or workstation)."
    echo "  DOTFILES_SKIP_TAGS:          Comma-separated list of tags to skip."
    echo "  DOTFILES_SKIP_DEPS:          Set to 'true' to skip dependency installation."
    echo "  NON_INTERACTIVE:             Set to 'true' to disable interactive prompts."
    echo
    echo "Example (interactive):"
    echo "  $0"
    echo
    echo "Example (non-interactive server setup, skipping 'debug' tag and dependency checks):"
    echo "  DOTFILES_SKIP_DEPS=true NON_INTERACTIVE=true DOTFILES_TYPE=server DOTFILES_SKIP_TAGS=debug $0"
    echo "  $0 --skip-deps --non-interactive --type server --skip-tags \"debug\""
}

detect_os_and_package_manager() {
    log "Detecting available package manager..."
    # Order matters: check for more specific/modern ones first.
    if command -v apt-get &>/dev/null; then
        PKG_MANAGER="apt-get"
        PRE_INSTALL_CMDS=("sudo" "apt-get" "update")
        INSTALL_CMD_BASE=("sudo" "apt-get" "install" "-y")
    elif command -v zypper &>/dev/null; then # For OpenSUSE
        PKG_MANAGER="zypper"
        # --gpg-auto-import-keys is useful for scripted refresh
        PRE_INSTALL_CMDS=("sudo" "zypper" "--non-interactive" "--gpg-auto-import-keys" "refresh")
        INSTALL_CMD_BASE=("sudo" "zypper" "--non-interactive" "install" "--no-confirm")
    elif command -v dnf &>/dev/null; then
        PKG_MANAGER="dnf"
        PRE_INSTALL_CMDS=() # dnf handles metadata refresh automatically
        INSTALL_CMD_BASE=("sudo" "dnf" "install" "-y")
    elif command -v yum &>/dev/null; then # For older RHEL/CentOS
        PKG_MANAGER="yum"
        PRE_INSTALL_CMDS=() # yum also handles metadata refresh
        INSTALL_CMD_BASE=("sudo" "yum" "install" "-y")
    elif command -v pacman &>/dev/null; then # For Arch Linux and derivatives
        PKG_MANAGER="pacman"
        PRE_INSTALL_CMDS=("sudo" "pacman" "-Sy" "--noconfirm")
        INSTALL_CMD_BASE=("sudo" "pacman" "-S" "--needed" "--noconfirm")
    else
        PKG_MANAGER="" # No supported package manager found
        # This will be handled by the caller (install_dependencies)
        return
    fi
    log "Using package manager: $PKG_MANAGER"
}

install_dependencies() {
    log "Checking dependencies..."
    local packages_to_install=()
    if ! command -v git &>/dev/null; then packages_to_install+=("git"); fi
    if ! command -v rsync &>/dev/null; then packages_to_install+=("rsync"); fi
    if ! command -v ansible &>/dev/null; then packages_to_install+=("ansible"); fi

    if [[ ${#packages_to_install[@]} -gt 0 ]]; then
        log "Missing dependencies: ${packages_to_install[*]}"
        if [[ "$SKIP_DEPS" == true ]]; then
            error "Dependency installation is skipped (--skip-deps or DOTFILES_SKIP_DEPS=true), but the following dependencies are missing: ${packages_to_install[*]}. Please install them manually and try again."
        fi

        # If not skipping deps, proceed to detect PM and install
        detect_os_and_package_manager # Populates PKG_MANAGER, PRE_INSTALL_CMDS, INSTALL_CMD_BASE

        if [[ -z "$PKG_MANAGER" ]]; then # Check if a package manager was found
            error "No supported package manager (apt-get, dnf, yum, zypper, pacman) was found on the system, and the following dependencies are missing: ${packages_to_install[*]}. Please install them manually."
        fi

        log "The following packages need to be installed: ${packages_to_install[*]}"
        if [[ "$INTERACTIVE_MODE" == true ]]; then
            read -r -p "Proceed with installation using $PKG_MANAGER? (y/N): " confirm
            if [[ "${confirm,,}" != "y" ]]; then # Convert to lowercase for case-insensitive comparison
                error "Dependency installation aborted by user."
            fi
        else
            log "Non-interactive mode: Proceeding with dependency installation using $PKG_MANAGER."
        fi

        if [[ ${#PRE_INSTALL_CMDS[@]} -gt 0 ]]; then
            log "Running pre-installation commands for $PKG_MANAGER (e.g., package list update)..."
            if ! "${PRE_INSTALL_CMDS[@]}"; then
                error "Pre-installation command (${PRE_INSTALL_CMDS[*]}) failed. Check package manager configuration and network."
            fi
            log "Pre-installation commands completed."
        fi

        log "Installing packages: ${packages_to_install[*]} using $PKG_MANAGER..."
        local full_install_cmd_array=("${INSTALL_CMD_BASE[@]}" "${packages_to_install[@]}")

        if ! "${full_install_cmd_array[@]}"; then
            error "Failed to install dependencies (${packages_to_install[*]}). Please install them manually and try again."
        fi
        log "Dependencies installed successfully."
    else
        log "All dependencies are already satisfied."
    fi
}

# --- Argument and Environment Variable Parsing ---
# Initialize from environment variables first (command-line args will override)
MACHINE_TYPE_FROM_ENV="${DOTFILES_TYPE:-}"
SKIP_TAGS_FROM_ENV="${DOTFILES_SKIP_TAGS:-}"
NON_INTERACTIVE_FROM_ENV="${NON_INTERACTIVE:-false}"
SKIP_DEPS_FROM_ENV="${DOTFILES_SKIP_DEPS:-false}"
FORCE_REMOTE_FROM_ENV="${DOTFILES_FORCE_REMOTE:-false}"

declare machine_type_arg_val=""
declare skip_tags_arg_val=""
declare non_interactive_arg_flag=false
declare skip_deps_arg_flag=false
declare force_remote_arg_flag=false

while [[ $# -gt 0 ]]; do
    case "$1" in
    --type)
        machine_type_arg_val="$2"
        shift 2
        ;;
    --skip-tags)
        skip_tags_arg_val="$2"
        shift 2
        ;;
    --skip-deps)
        skip_deps_arg_flag=true
        shift
        ;;
    --force-remote)
        force_remote_arg_flag=true
        shift
        ;;
    --non-interactive)
        non_interactive_arg_flag=true
        shift
        ;;
    -h | --help)
        print_usage
        exit 0
        ;;
    *) error "Unknown option: $1\n$(print_usage)" ;;
    esac
done

# Determine final INTERACTIVE_MODE setting (CLI flag > ENV var > TTY detection)
if [[ "$non_interactive_arg_flag" == true ]]; then
    INTERACTIVE_MODE=false
    log "Non-interactive mode forced by --non-interactive flag."
elif [[ "${NON_INTERACTIVE_FROM_ENV,,}" == "true" ]]; then
    INTERACTIVE_MODE=false
    log "Non-interactive mode enabled by NON_INTERACTIVE environment variable."
elif [[ -t 0 ]]; then # stdin is a TTY
    INTERACTIVE_MODE=true
else
    INTERACTIVE_MODE=false
    log "Non-interactive mode."
fi

# Determine final SKIP_DEPS setting (CLI flag > ENV var > default)
if [[ "$skip_deps_arg_flag" == true ]]; then
    SKIP_DEPS=true
    log "Dependency installation will be skipped due to --skip-deps flag."
elif [[ "${SKIP_DEPS_FROM_ENV,,}" == "true" ]]; then
    SKIP_DEPS=true
    log "Dependency installation will be skipped due to DOTFILES_SKIP_DEPS environment variable."
fi

# Determine FORCE_REMOTE
if [[ "$force_remote_arg_flag" == true ]]; then
    FORCE_REMOTE=true
    log "Remote installation forced by --force-remote flag."
elif [[ "${FORCE_REMOTE_FROM_ENV,,}" == "true" ]]; then
    FORCE_REMOTE=true
    log "Remote installation forced by DOTFILES_FORCE_REMOTE env var."
fi

# Determine final MACHINE_TYPE (CLI arg > ENV var > Prompt)
if [[ -n "$machine_type_arg_val" ]]; then
    MACHINE_TYPE="$machine_type_arg_val"
    log "Machine type set to '$MACHINE_TYPE' from --type argument."
elif [[ -n "$MACHINE_TYPE_FROM_ENV" ]]; then
    MACHINE_TYPE="$MACHINE_TYPE_FROM_ENV"
    log "Machine type set to '$MACHINE_TYPE' from DOTFILES_TYPE environment variable."
elif [[ "$INTERACTIVE_MODE" == true ]]; then
    log "Prompting for machine type..."
    menu_options=("Server" "Workstation")
    # Set the prompt for the select command
    # shellcheck disable=SC2034 # PS3 is used by select
    PS3="Select machine type (enter number): "

    select selected_option_text in "${menu_options[@]}"; do
        if [[ -n "$selected_option_text" ]]; then    # Check if a valid option was selected
            MACHINE_TYPE="${selected_option_text,,}" # Convert to lowercase (e.g., "Server" -> "server")
            log "Machine type set to '$MACHINE_TYPE'."
            break # Exit the select loop
        else
            warn "Invalid selection '$REPLY'. Please enter a number from 1 to ${#menu_options[@]}."
            # The select construct will automatically re-display the prompt and menu.
        fi
    done
    unset PS3
    unset menu_options
else # Non-interactive and type not specified
    error "Machine type not specified. Use --type <server|workstation> or DOTFILES_TYPE env var in non-interactive mode."
fi

# Validate MACHINE_TYPE and set PLAYBOOK_FILE
if [[ "$MACHINE_TYPE" == "server" ]]; then
    PLAYBOOK_FILE="server.yml"
elif [[ "$MACHINE_TYPE" == "workstation" ]]; then
    PLAYBOOK_FILE="workstation.yml"
else
    error "Invalid machine type '$MACHINE_TYPE'. Must be 'server' or 'workstation'."
fi
log "Using playbook: $PLAYBOOK_FILE"

# Determine if running from local repo copy, considering FORCE_REMOTE
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
# RUNNING_FROM_LOCAL_REPO is initialized to false

if [[ "$FORCE_REMOTE" == true ]]; then
    log "Remote installation is forced. 'ansible-pull' will be used."
    # RUNNING_FROM_LOCAL_REPO remains false
elif [[ -f "${SCRIPT_DIR}/${PLAYBOOK_FILE}" ]]; then
    # Local playbook exists AND remote is not forced
    RUNNING_FROM_LOCAL_REPO=true
    log "Selected playbook '${PLAYBOOK_FILE}' found locally at '${SCRIPT_DIR}', and remote not forced."
else
    # Local playbook does not exist (and remote is not forced, which doesn't change the outcome here)
    log "Selected playbook '${PLAYBOOK_FILE}' not found locally at '${SCRIPT_DIR}'. 'ansible-pull' will be used."
    # RUNNING_FROM_LOCAL_REPO remains false
fi

# Determine final SKIP_TAGS (CLI arg > ENV var > Prompt)
if [[ -n "$skip_tags_arg_val" ]]; then
    SKIP_TAGS="$skip_tags_arg_val"
    log "Skip tags set to '$SKIP_TAGS' from --skip-tags argument."
elif [[ -n "$SKIP_TAGS_FROM_ENV" ]]; then
    SKIP_TAGS="$SKIP_TAGS_FROM_ENV"
    log "Skip tags set to '$SKIP_TAGS' from DOTFILES_SKIP_TAGS environment variable."
elif [[ "$INTERACTIVE_MODE" == true ]]; then
    read -r -p "Enter any Ansible tags to skip (comma-separated, e.g., tag1,tag2) or press Enter for none: " tags_input
    SKIP_TAGS="$tags_input" # Can be empty
else                        # Non-interactive and skip_tags not specified
    SKIP_TAGS=""            # Default to no skip tags
fi

if [[ -n "$SKIP_TAGS" ]]; then
    log "Ansible tags to skip: '$SKIP_TAGS'"
else
    log "No Ansible tags will be skipped."
fi

# --- Main Execution ---
log "Starting dotfiles installation script."

install_dependencies # This function handles all dependency logic including skipping

# Prepare Ansible command array
declare -a ansible_cmd_array
if [[ "$RUNNING_FROM_LOCAL_REPO" == true ]]; then
    ansible_cmd_array+=("ansible-playbook")
    ansible_cmd_array+=("${SCRIPT_DIR}/${PLAYBOOK_FILE}") # Full path to local playbook
    log "Configured to use 'ansible-playbook' with local playbook."
else
    ansible_cmd_array+=("ansible-pull")
    ansible_cmd_array+=("-U" "$ANSIBLE_REPO_URL")
    ansible_cmd_array+=("$PLAYBOOK_FILE") # Playbook name relative to repo root for ansible-pull
    log "Configured to use 'ansible-pull' from remote repository: $ANSIBLE_REPO_URL"
fi

if [[ -n "$SKIP_TAGS" ]]; then
    ansible_cmd_array+=("--skip-tags" "$SKIP_TAGS")
fi

# Determine if 'use_become' tag is being skipped
use_become_is_skipped=false
if [[ -n "$SKIP_TAGS" ]]; then
    old_ifs="$IFS" # Save current IFS
    IFS=','
    #SC2086: Double quote to prevent globbing and word splitting (not an issue here as we want splitting by comma)
    #However, for safety with extglob, better to loop carefully.
    read -r -a tag_array <<<"$SKIP_TAGS" # Use read -r -a to split into an array safely
    IFS="$old_ifs"                       # Restore IFS

    for tag_to_check in "${tag_array[@]}"; do
        # Trim whitespace from tag_to_check
        shopt -s extglob
        trimmed_tag="${tag_to_check##*( )}" # Remove leading whitespace
        trimmed_tag="${trimmed_tag%%*( )}"  # Remove trailing whitespace
        shopt -u extglob
        if [[ "$trimmed_tag" == "use_become" ]]; then
            use_become_is_skipped=true
            break
        fi
    done
fi

if [[ "$INTERACTIVE_MODE" == true ]]; then
    if [[ "$use_become_is_skipped" == true ]]; then
        log "'use_become' tag is in skip_tags. Ansible will not prompt for become password via --ask-become-pass."
    else
        log "Interactive mode and 'use_become' not skipped: Adding --ask-become-pass to Ansible command."
        ansible_cmd_array+=("--ask-become-pass")
    fi
else # Non-interactive mode
    if [[ "$use_become_is_skipped" == true ]]; then
        log "Non-interactive mode: 'use_become' tag is skipped."
    else
        log "Non-interactive mode and 'use_become' not skipped: Not adding --ask-become-pass."
        log "Ensure passwordless sudo is configured or Ansible handles privilege escalation non-interactively if 'become: yes' is used in playbook."
    fi
fi

log "Preparing to execute Ansible..."
echo "---------------------------------------------------------------------"
echo "Executing command:"

# Construct the command string for display and potential error reporting
cmd_display_parts=()
for arg_item in "${ansible_cmd_array[@]}"; do
    cmd_display_parts+=("$(printf "%q" "$arg_item")")
done
OIFS_DISPLAY="$IFS"
IFS=' '
ansible_command_to_display="${cmd_display_parts[*]}"
IFS="$OIFS_DISPLAY"

echo "  ${ansible_command_to_display}"
echo "---------------------------------------------------------------------"
echo "--- Ansible Output Starts ---"

if "${ansible_cmd_array[@]}"; then
    log "Ansible command completed successfully."
else
    error "Ansible command failed. Check output above for details. The command executed was: ${ansible_command_to_display}"
fi

echo "--- Ansible Output Ends ---"
log "Dotfiles installation script finished successfully."
exit 0
