'use strict'

const toProc = require('./util/to-proc')

function register (registry, context) {
  if (!(registry && context)) return // NOTE only works as scoped extension for now
  registry.$groups().$store('springio/javadoc', toProc(createExtensionGroup(context)))
  return registry
}

function createExtensionGroup (context) {
  return function () {
    this.inlineMacro('javadoc', function () {
      var self = this
      self.process(function (parent, target) {
        const className = target.split('.').slice(-1)
        const relativePath = target.replaceAll('.', '/') + '.html'
        const text = `xref:attachment\$api/java/${relativePath}[\`${className}\`, role=apiref]`
        return self.createInline(parent, 'quoted', text, {})
      })
    })
  }
}

module.exports = { register, createExtensionGroup }

