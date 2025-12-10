'use strict'

const toProc = require('./util/to-proc')
const { posix: path } = require('path')

const INCLUDE_FAMILIES = ['attachment', 'example', 'partial']

function register (registry, context) {
  if (!(registry && context)) return // NOTE only works as scoped extension for now
  registry.$groups().$store('springio/include-code', toProc(createExtensionGroup(context)))
  return registry
}

function createExtensionGroup (context) {
  return function () {
    const PreprocessorReader = global.Opal.Asciidoctor.PreprocessorReader
    let langs, tabsEnabled
    this.blockMacro(function () {
      this.named('include-code')
      this.process((parent, target, attrs) => {
        const doc = parent.getDocument()
        const relativePathPrefix = './'
        const useRelativePath = target && target.startsWith(relativePathPrefix)
        const adocTarget = useRelativePath ? target.slice(relativePathPrefix.length) : target
        const requiredLangsAttrName = 'include-code-required-langs'
        const requiredLangs = getRequiredLangs(doc, attrs['langs'], doc.getAttribute(requiredLangsAttrName))
        langs ??= [['java'], ['kotlin', '.kt'], ['groovy'], ['xml']].reduce((accum, [lang, ext]) => {
          const template = getTemplateForLang(doc, lang)
          const required = requiredLangs.includes(lang)
          if (template) accum.push({ name: lang[0].toUpperCase() + lang.slice(1), lang, ext: ext || '.' + lang, template, required })
          return accum
        }, [])
        if (!langs.length) return log(doc, 'warn', `no search locations defined for include-code::${target}[]`)
        const notConfiguredRequiredLangs = requiredLangs.filter ((lang) => !langs.find((l) => l.lang === lang))
        if (notConfiguredRequiredLangs.length) {
          const missingAttrNames = notConfiguredRequiredLangs.map((lang) => getTemplateAttrName(lang) ).join(', ')
          return log(doc, 'warn', `include-code is missing the required attributes [${missingAttrNames}] for the required langs [${requiredLangs}]`)
        }
        const cursor = doc.getReader().$cursor_at_mark()
        tabsEnabled ??= doc.getExtensions().hasBlocks() && !!doc.getExtensions().getBlockFor('tabs', 'example')
        const attrsStr = Object.entries(attrs)
          .filter(([n, v]) => n !== 'title')
          .reduce((buf, [n, v]) => `${buf}${buf ? ',' : ''}${n}=${v}`, '')
        const sectionId = (nearest(parent, 'section') || doc).getId()
        const adocId = (sectionId) ? sectionId.replaceAll('-', '').replaceAll('.', '/') : ''
        const srcPath = doc.getAttribute('page-relative-src-path')
        const parsedSrcPath = path.parse(srcPath)
        const adocFilename = parsedSrcPath.name.replaceAll('-', '')
        const dirPath = parsedSrcPath.dir.replaceAll('-', '')
        const adocPath = dirPath === '.' ? '' : dirPath
        const adocRelativePath = useRelativePath && dirPath !== '.' ? dirPath + '/' : ''
        const { file, contentCatalog } = context
        const resources = langs.reduce((accum, { name, lang, ext, template, required }) => {
          const templateVars = {
            adoc_path: adocPath,
            adoc_relative_path: adocRelativePath,
            adoc_filename: adocFilename,
            adoc_id: adocId,
            adoc_target: adocTarget,
            lang_ext: ext
          }
          // eslint-disable-next-line no-template-curly-in-string
          const ref = replaceAllRecursively(Object.entries(templateVars).reduce((t, [k, v]) => t.replaceAll(`\${${k}}`, v), template), '//', '/')
          if (ref.includes('${')) {
            log(doc, 'warn', `include-code is using a template "${template}" that after processing resulted with unprocessed variables "${ref}"`)
          }
          const exists = contentCatalog.resolveResource(ref, file.src, undefined, INCLUDE_FAMILIES)
          const lines = exists ? PreprocessorReader.$new(doc, [`include::${ref}[${attrsStr}]`], cursor).readLines() : null
          return accum.concat({ ref, name, lang, lines, exists, required })
        }, [])
        const includes = resources.filter((r) => {
          return r.exists
        })
        const missingRequiredLangs = resources.filter((r) => r.required && !r.exists).map((r) => r.lang)
        const pathsChecked = resources.map((r) => `{ ref: ${r.ref}, exists: ${!!r.exists}, required: ${r.required}, lang: ${r.lang} }`).join(', ')
        const pathsCheckedInfo = `include-code checked the paths [${pathsChecked}] for target ${target}`
        if (!includes.length) {
          return log(doc, 'warn', `${pathsCheckedInfo}; No includes found`)
        } else if (missingRequiredLangs.length) {
          return log(doc, 'warn', `${pathsCheckedInfo}; Missing includes for the langs: ${missingRequiredLangs}`)
        } else {
          log(doc, 'info', pathsCheckedInfo)
        }
        const tabsSource = generateTabsSource(attrs.title, attrs['sync-group-id'], includes, tabsEnabled, attrsStr)
        const reader = PreprocessorReader.$new(doc, tabsSource, cursor)
        Object.defineProperty(reader, 'lineno', { get: () => cursor.lineno })
        return this.parseContent(parent, reader)
      })
    })
  }
}

/**
 *
 * @param doc
 * @param lang
 * @returns the template to use for the given language, or null if none is configured
 */
function getTemplateForLang(doc, lang) {
  const templateAttrName = getTemplateAttrName(lang)
  const templateAttrValue = doc.getAttribute(templateAttrName)
  if (templateAttrValue) {
    return templateAttrValue
  }
  const baseAttrName = `include-code-${lang}-base`
  const baseTemplateSuffix = '${adoc_path}/${adoc_filename}/${adoc_target}${lang_ext}'
  const baseTemplate = getTemplateForPrefixAttrName(doc, baseAttrName, baseTemplateSuffix)
  if (baseTemplate) {
    return baseTemplate
  }
  const includeLangAttrName = `include-${lang}`
  // The default template is specified for backward compatibility
  // eslint-disable-next-line no-template-curly-in-string
  const includeLangTemplateSuffix = '${adoc_relative_path}/${adoc_id}/${adoc_target}${lang_ext}'
  return getTemplateForPrefixAttrName(doc, includeLangAttrName, includeLangTemplateSuffix)
}

function getTemplateAttrName(lang) {
    return `include-code-${lang}-template`
}

/**
 *
 * @param doc
 * @param templatePrefixAttrName the attribute name that is the prefix for the template
 * @param templateSuffix the template suffix to append to the base path
 * @returns {null|string}
 */
function getTemplateForPrefixAttrName(doc, templatePrefixAttrName, templateSuffix) {
    const attrValue = doc.getAttribute(templatePrefixAttrName)
    if (attrValue) {
      return `${attrValue}/${templateSuffix}`
    }
    return null
}

function getRequiredLangs(doc, macroLangsStr, docLangsStr) {
  const macroLangs = macroLangsStr?.split(',')
  const macroAddLangs = macroLangs?.filter((lang) => lang.startsWith('+')).map((lang) => lang.slice(1)) || []
  const macroRemoveLangs = macroLangs?.filter((lang) => lang.startsWith('-')).map((lang) => lang.slice(1)) || []
  const docLangs = docLangsStr?.split(',') || []
  if (macroAddLangs.length || macroRemoveLangs.length) {
    if (macroLangs.length != (macroAddLangs.length + macroRemoveLangs.length)) {
      log(doc, 'warn', `langs attribute cannot mix and match add/remove with setting of attributes; got langs="${macroLangsStr}"`)
    }
    return docLangs.filter((lang) => !macroRemoveLangs.includes(lang)).concat(macroAddLangs)
  }
  return macroLangs || docLangs
}

function replaceAllRecursively (str, search, replacement) {
  let result = str
  while (result.includes(search)) {
    result = result.replaceAll(search, replacement)
  }
  return result
}

function generateTabsSource (title, syncGroupId, includes, tabsEnabled, attrsStr) {
  const source = []
  if (includes.length === 1) {
    if (title) source.push('.' + title)
    source.push(`[${attrsStr}]`)
    source.push(`[,${includes[0].lang}]`, '----', ...includes[0].lines, '----')
  } else if (tabsEnabled) {
    if (title) source.push('.' + title)
    const lastIdx = includes.length - 1
    const tabAttrs = syncGroupId ? `,sync-group-id=${syncGroupId}` : ''
    includes.forEach(({ name, lang, lines }, idx) => {
      idx ? source.push('') : source.push(`[tabs${tabAttrs}]`, '======')
      source.push(`${name}::`, '+', `[${attrsStr}]`, `[,${lang}]`, '----', ...lines, '----')
      if (idx === lastIdx) source.push('======')
    })
  } else {
    includes.forEach(({ name, lang, lines }) => {
      if (source.length) source.push('')
      source.push('.' + (title ? title + ' - ' + name : name), `[${attrsStr}]`, `[,${lang}]`, '----', ...lines, '----')
    })
  }
  return source
}

function log (doc, severity, message) {
  doc.getLogger()[severity](doc.createLogMessage(message, { source_location: doc.getReader().$cursor_at_mark() }))
}

function nearest (node, context) {
  return !node || node.getContext() === context ? node : nearest(node.getParent(), context)
}

module.exports = { register, createExtensionGroup }
