import {createVercelApplication} from '../server/vercel-app.mjs';
const handler=createVercelApplication();
export default {fetch:handler};
