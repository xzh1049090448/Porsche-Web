import ElAlert from 'element-plus/es/components/alert/index.mjs'
import ElButton from 'element-plus/es/components/button/index.mjs'
import ElConfigProvider from 'element-plus/es/components/config-provider/index.mjs'
import { ElForm, ElFormItem } from 'element-plus/es/components/form/index.mjs'
import ElInput from 'element-plus/es/components/input/index.mjs'
import ElTooltip from 'element-plus/es/components/tooltip/index.mjs'
import 'element-plus/es/components/alert/style/css.mjs'
import 'element-plus/es/components/button/style/css.mjs'
import 'element-plus/es/components/form/style/css.mjs'
import 'element-plus/es/components/input/style/css.mjs'
import 'element-plus/es/components/tooltip/style/css.mjs'
import 'element-plus/es/components/message/style/css.mjs'

export function installGuestUi(app) {
  for (const component of [ElAlert, ElButton, ElConfigProvider, ElForm, ElFormItem, ElInput, ElTooltip]) {
    app.use(component)
  }
}
