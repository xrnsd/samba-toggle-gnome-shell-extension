import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { exec } from './utils';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {
	QuickMenuToggle,
	SystemIndicator,
} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {
	Extension,
	gettext as _,
	type ConsoleLike,
	type ExtensionMetadata,
} from 'resource:///org/gnome/shell/extensions/extension.js';

interface SystemdUnit {
	active: string;
}

const QuickSettingsMenu = GObject.registerClass(
	class QuickSettingsMenu extends QuickMenuToggle {
		constructor(readonly _extension: SambaToggle) {
			super({
				title: _('Samba'),
				toggleMode: true,
				menuEnabled: false,
				gicon: Gio.icon_new_for_string(
					`${_extension.path}/icons/sambd.svg`,
				),
			});

			this.connect('clicked', async () => {
				const newState = this.checked ? 'start' : 'stop';

				const { error } = await exec([
					'systemctl',
					'--user',
					newState,
					'--output=json',
					'sambd.service',
				]);

				if (error) {
					return this._extension?.logger.error(
						`Error switching to ${newState}d state`,
						error,
					);
				}

				await this._extension?._sync();
			});
		}
	},
);

export default class SambaToggle extends Extension {
	private _indicator: InstanceType<typeof SystemIndicator> | null = null;
	private _menu: InstanceType<typeof QuickSettingsMenu> | null = null;
	private _sourceId: number | null = null;
	public readonly logger: ConsoleLike;

	constructor(metadata: ExtensionMetadata) {
		super(metadata);
		this.logger = this.getLogger();
	}

	enable() {
		this._menu = new QuickSettingsMenu(this);
		this._indicator = new SystemIndicator();
		this._indicator.quickSettingsItems.push(this._menu);
		Main.panel.statusArea.quickSettings.addExternalIndicator(
			// @ts-expect-error who knows
			this._indicator,
		);

		this._sourceId = GLib.timeout_add_seconds(
			GLib.PRIORITY_DEFAULT,
			5,
			() => {
				this._sync();
				return GLib.SOURCE_CONTINUE;
			},
		);

		this._sync();
	}

	disable() {
		this._indicator?.destroy();
		this._indicator = null;

		this._menu?.destroy();
		this._menu = null;

		if (this._sourceId) {
			GLib.Source.remove(this._sourceId);
			this._sourceId = null;
		}
	}

	async _sync() {
		const { output, error } = await exec([
			'systemctl',
			'--user',
			'list-units',
			'--output=json',
			'sambd.service',
		]);

		if (error) {
			this.logger.error('Error getting Samba status:', error);
			return null;
		}

		const units: SystemdUnit[] = JSON.parse(output);

		if (units.length > 1) {
			const units = JSON.parse(output);
			this.logger.error('Unexpected number of units:', units);
			return null;
		}

		const active = units.length ? units[0].active === 'active' : false;
		this._menu!.set_checked(active);
	}
}
