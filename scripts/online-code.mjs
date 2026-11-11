// Prints "on" or "off": whether this install runs online Code (app/install.mjs onlineCodeRule: ONLINE_CODE in the environment, else
// the install's setting, off by default). scripts/box-live.sh asks it so a deploy installs what only online Code needs just when it is on.
// Run: UI_DATA_DIR=<data> node [--env-file=<aqeelOS env>] scripts/online-code.mjs
import {onlineCodeOn} from '../app/install.mjs';
process.stdout.write(onlineCodeOn()?'on\n':'off\n');
