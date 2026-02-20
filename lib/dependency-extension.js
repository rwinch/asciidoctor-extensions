'use strict'

const toProc = require('./util/to-proc')

function register (registry) {
  if (!registry) return this.register('springio/dependency', toProc(createExtensionGroup()))
  registry.$groups().$store('springio/dependency', toProc(createExtensionGroup()))
  return registry
}

function createExtensionGroup () {
  return function () {
    this.blockMacro(function () {
      this.named('dependency')
      this.process((parent, target, attrs) => {
        const doc = parent.getDocument()
        const parts = target ? target.split(':') : []
        if (parts.length < 2) {
          const logger = doc.getLogger()
          if (logger && typeof logger.warn === 'function') {
            logger.warn(
              doc.createLogMessage(
                `dependency macro requires group:artifact or group:artifact:version, got: ${target}`,
                {
                  source_location: doc.getReader().$cursor_at_mark(),
                }
              )
            )
          }
          return null
        }
        const groupId = parts[0]
        const artifactId = parts[1]
        const version = parts.length >= 3 ? parts[2] : undefined
        const hasVersion = version !== undefined && version.length > 0

        const mavenLines = [
          '<dependency>',
          `    <groupId>${groupId}</groupId>`,
          `    <artifactId>${artifactId}</artifactId>`,
        ]
        if (hasVersion) {
          mavenLines.push(`    <version>${version}</version>`)
        }
        mavenLines.push('</dependency>')

        const gradleCoord = hasVersion ? `${groupId}:${artifactId}:${version}` : `${groupId}:${artifactId}`
        const gradleLines = [`implementation '${gradleCoord}'`]

        const PreprocessorReader = global.Opal.Asciidoctor.PreprocessorReader
        const cursor = doc.getReader().$cursor_at_mark()
        const tabsSource = [
          '[tabs]',
          '======',
          'Maven::',
          '+',
          '[source,xml,role="primary"]',
          '----',
          ...mavenLines,
          '----',
          '',
          'Gradle::',
          '+',
          '[source,groovy,role="secondary"]',
          '----',
          ...gradleLines,
          '----',
          '======',
        ]
        const reader = PreprocessorReader.$new(doc, tabsSource, cursor)
        Object.defineProperty(reader, 'lineno', { get: () => cursor.lineno })
        return this.parseContent(parent, reader)
      })
    })
  }
}

module.exports = { register, createExtensionGroup }
