/* jshint esnext:true */
/*
 *
 *  GRUB reboot for GNOME Shell
 *  - Adds a "Reboot to..." button to the power-off dialog to select the OS to boot into
 *
 * Copyright (C) 2014 - 2015
 *     Patrizio Bruno <desertconsulting@gmail.com>
 *
 * This file is part of gnome-shell-extension-grubreboot.
 *
 * gnome-shell-extension-grubreboot is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * gnome-shell-extension-grubreboot is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with gnome-shell-extension-openweather.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

const ExtensionUtils = imports.misc.extensionUtils;
const This = ExtensionUtils.getCurrentExtension();
const Utils = This.imports.utils;
const St = imports.gi.St;
const Main = imports.ui.main;
//const Util = imports.util;
const PopupMenu = imports.ui.popupMenu;
const Lang = imports.lang;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Convenience = This.imports.convenience;
const Gettext = imports.gettext.domain(This.metadata['gettext-domain']);
const G_ = Gettext.gettext;

let backup;
let backupButton;
let backupButtonIdx;
let cancelBackup;
let popupMenu;

function init() {
  Convenience.initTranslations();
  backupButton = null;
  backupButtonIdx = -1;
}

function cancel() {
  if (popupMenu) {
    popupMenu.destroy();
    popupMenu = null;
  }
  cancelBackup.apply(this, arguments);
}

function enable() {
  let confirmButtons = Main.EndSessionDialog.shutdownDialogContent.confirmButtons
    , buttonIdx
    , button;

  for (let i = 0, n = confirmButtons.length; i < n; i++) {
    if (confirmButtons[i].signal == 'ConfirmedReboot') {
      buttonIdx = i;
      break;
    }
  }

  button = {
    signal: 'ConfirmedReboot'
    , label: G_("...")
    , buttonType: 'menu'
    , action: function (button, dialog, signal) {
      if (popupMenu) {
        popupMenu.removeAll();
        Main.EndSessionDialog._endSessionDialog._group.remove_actor(popupMenu.actor);
        popupMenu.destroy();
        popupMenu = null;
      } else {
        let popup = new PopupMenu.PopupMenu(button, 0.0, St.Side.TOP, 0);
        popupMenu = popup;
        Main.EndSessionDialog._endSessionDialog._group.add_actor(popup.actor);
        populatePopup(signal, dialog, popup);
        popup.toggle();
      }
    }
  };

  backupButtonIdx = buttonIdx + 1;

  if (buttonIdx >= 0) {
    backupButton = confirmButtons[buttonIdx];
    //confirmButtons[buttonIdx] = button;
    confirmButtons.splice(backupButtonIdx, 0, button);
  } else {
    confirmButtons.push(button);
  }

  cancelBackup = Main.EndSessionDialog._endSessionDialog.cancel;
  Main.EndSessionDialog._endSessionDialog.cancel = cancel;

  backup = Main.EndSessionDialog._endSessionDialog._updateButtons;
  Main.EndSessionDialog._endSessionDialog._updateButtons = function () {
    let dialogContent = Main.EndSessionDialog.DialogContent[this._type];
    let buttons = [{
      action: Lang.bind(this, this.cancel),
      label: _("Cancel"),
      key: Clutter.Escape
    }];

    for (let i = 0, n = dialogContent.confirmButtons.length; i < n; i++) {
      let signal = dialogContent.confirmButtons[i].signal;
      let label = dialogContent.confirmButtons[i].label;
      let buttonType = dialogContent.confirmButtons[i].buttonType;
      let actionFunc = dialogContent.confirmButtons[i].action;

      if (typeof(buttonType) == 'undefined') {
        buttons.push({
          action: Lang.bind(this, function () {
            this.close(true);
            let signalId = this.connect('closed',
              Lang.bind(this, function () {
                this.disconnect(signalId);
                this._confirm(signal);
              }));
          }),
          label: label
        });
      } else if (buttonType == 'menu') {
        let dialog = this;
        buttons.push({
          action: function (button) {
            actionFunc(button, dialog, signal);
          },
          label: label
        });
      }
    }

    this.setButtons(buttons);
  };
}

function populatePopup(signal, dialog, popup) {

  let file = getFile();
  let stream = Gio.DataInputStream.new(file.read(null));
  let line;
  let rx = /^menuentry ['"]([^'"]+)/;
  let count = 0;
  while ((line = stream.read_line(null))) {
    if (count++ > 600) break;
    let res = rx.exec(line);
    if (res && res.length) {
      addPopupItem(signal, dialog, popup, res[1]);
    }
  }
  stream.close(null);
}

function getFile() {

  let file;

  // fedora derivatives have /etc/grub2.cfg and /etc/grub2-efi.cfg that links to the location of the BIOS and EFI installs.
  if ((Gio.file_new_for_path("/etc/grub2-efi.cfg").query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) == Gio.FileType.SYMBOLIC_LINK)
      && (Gio.file_new_for_path("/sys/firmware/efi").query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) == Gio.FileType.DIRECTORY)) {
    file = findFile(Gio.file_new_for_path("/boot/efi"));
  }
  if (!file) {
    file = Gio.file_new_for_path("/boot/grub/grub.cfg");
  }
  return file;
}

function findFile(dir) {

  let rv;
  if (dir.query_file_type(Gio.FileQueryInfoFlags.NONE, null) == Gio.FileType.DIRECTORY) {
    let fenum = dir.enumerate_children("", Gio.FileQueryInfoFlags.NONE, null);
    let file;
    while (!rv && (file = fenum.next_file(null))) {
      if ((file.get_file_type() == Gio.FileType.REGULAR)
        && file.get_name() == 'grub.cfg') {
        rv = Gio.file_new_for_path(dir.get_path() + '/grub.cfg');
      } else if (file.get_file_type() == Gio.FileType.DIRECTORY) {
        rv = findFile(Gio.file_new_for_path(dir.get_path() + '/' + file.get_name()));
      }
    }
    fenum.close(null);
  }
  return rv;
}

function addPopupItem(signal, dialog, popup, item) {
  popup.addAction(item, function () {
    Utils.trySpawnCommandLine("/usr/bin/pkexec --user root /usr/sbin/grub-reboot '" + item + "'", function (pid, status, data) {
      if (status === 0) {
        let signalId = dialog.connect('closed',
          Lang.bind(dialog, function () {
            this.disconnect(signalId);
            this._confirm(signal);
          }));
        dialog.close();
      }
    });
  });
}

function disable() {
  if (backupButton) {
    Main.EndSessionDialog.shutdownDialogContent.confirmButtons.splice(backupButtonIdx, 1);
  } else {
    Main.EndSessionDialog.shutdownDialogContent.confirmButtons.pop();
  }

  if (cancelBackup) {
    Main.EndSessionDialog._endSessionDialog.cancel = cancelBackup;
  }

  backupButton = null;
  backupButtonIdx = -1;

  Main.EndSessionDialog._endSessionDialog._updateButtons = backup;

  if (popupMenu) {
    Main.EndSessionDialog._endSessionDialog._group.remove_actor(popupMenu.actor);
    popupMenu.destroy();
    popupMenu = null;
  }
}

