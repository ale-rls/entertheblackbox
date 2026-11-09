import { registerRootComponent } from 'expo';
import App from './src/App';
import { loadOptik } from './src/fonts';

loadOptik();
registerRootComponent(App);
