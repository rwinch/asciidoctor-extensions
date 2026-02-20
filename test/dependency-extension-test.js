/* eslint-env mocha */
'use strict'

const Asciidoctor = require('@asciidoctor/core')()
const { configureLogger } = require('@antora/logger')
const loadAsciiDoc = require('@antora/asciidoc-loader')
const { expect, heredoc } = require('./harness')
const { name: packageName } = require('#package')

describe('dependency-extension', () => {
  const ext = require(packageName + '/dependency-extension')

  const defaultFile = {
    src: {
      component: 'spring-boot',
      version: '3.0.0',
      module: 'ROOT',
      family: 'page',
      relative: 'index.adoc',
      path: 'index.adoc',
    },
    pub: { moduleRootPath: '' },
  }

  const contentCatalog = { files: [], getById: () => undefined, getComponent: () => undefined }

  const run = (input = [], opts = {}) => {
    opts.extensions = [ext]
    const inputFile = { ...defaultFile, contents: Buffer.from(Array.isArray(input) ? input.join('\n') : input) }
    return loadAsciiDoc(inputFile, contentCatalog, opts)
  }

  beforeEach(() => {
    configureLogger({ destination: { write: () => {} } })
  })

  describe('bootstrap', () => {
    it('should be able to require extension', () => {
      expect(ext).to.be.instanceOf(Object)
      expect(ext.register).to.be.instanceOf(Function)
    })

    it('should register to bound extension registry if register function called with no arguments', () => {
      try {
        ext.register.call(Asciidoctor.Extensions)
        const extGroups = Asciidoctor.Extensions.getGroups()
        const extGroupKeys = Object.keys(extGroups)
        expect(extGroupKeys).to.have.lengthOf(1)
        expect(extGroupKeys[0]).to.equal('springio/dependency')
      } finally {
        Asciidoctor.Extensions.unregisterAll()
      }
    })

    it('should be able to call register function exported by extension', () => {
      const extensions = run().getExtensions()
      expect(extensions).to.exist()
      expect(extensions.getBlockMacros()).to.have.lengthOf(1)
      expect(extensions.getBlockMacros()[0].instance.name).to.equal('dependency')
    })
  })

  describe('dependency macro', () => {
    it('should output Maven and Gradle tabs with version when group:artifact:version', () => {
      const input = 'dependency::org.springframework:spring-core:7.0.0[]'
      const doc = run(input)
      const blocks = doc.getBlocks()
      expect(blocks).to.have.lengthOf(1)
      const tabs = blocks[0]
      expect(tabs.getContext()).to.equal('example')

      const listings = tabs.findBy({ context: 'listing' })
      expect(listings).to.have.lengthOf(2)

      const mavenBlock = listings[0]
      expect(mavenBlock.getAttribute('language')).to.equal('xml')
      expect(mavenBlock.getSource()).to.equal(heredoc`
      <dependency>
          <groupId>org.springframework</groupId>
          <artifactId>spring-core</artifactId>
          <version>7.0.0</version>
      </dependency>
      `)

      const gradleBlock = listings[1]
      expect(gradleBlock.getAttribute('language')).to.equal('groovy')
      expect(gradleBlock.getSource().trim()).to.equal("implementation 'org.springframework:spring-core:7.0.0'")
    })

    it('should output Maven and Gradle tabs without version when group:artifact:[]', () => {
      const input = 'dependency::org.springframework:spring-core:[]'
      const doc = run(input)
      const blocks = doc.getBlocks()
      expect(blocks).to.have.lengthOf(1)
      const tabs = blocks[0]
      const listings = tabs.findBy({ context: 'listing' })

      const mavenBlock = listings[0]
      expect(mavenBlock.getSource()).to.equal(heredoc`
      <dependency>
          <groupId>org.springframework</groupId>
          <artifactId>spring-core</artifactId>
      </dependency>
      `)

      const gradleBlock = listings[1]
      expect(gradleBlock.getSource().trim()).to.equal("implementation 'org.springframework:spring-core'")
    })

    it('should output Maven and Gradle tabs without version when group:artifact (two parts)', () => {
      const input = 'dependency::org.springframework:spring-core[]'
      const doc = run(input)
      const listings = doc.getBlocks()[0].findBy({ context: 'listing' })
      expect(listings[0].getSource()).to.include('<groupId>org.springframework</groupId>')
      expect(listings[0].getSource()).to.not.include('<version>')
      expect(listings[1].getSource().trim()).to.equal("implementation 'org.springframework:spring-core'")
    })

    it('should set primary role on Maven and secondary on Gradle', () => {
      const input = 'dependency::org.springframework:spring-core:7.0.0[]'
      const doc = run(input)
      const listings = doc.getBlocks()[0].findBy({ context: 'listing' })
      expect(listings[0].hasRole('primary')).to.be.true()
      expect(listings[1].hasRole('secondary')).to.be.true()
    })

    it('should warn and return null when target has fewer than two colon-separated parts', () => {
      const input = 'dependency::org.springframework[]'
      const doc = run(input, { sourcemap: true })
      const blocks = doc.getBlocks()
      expect(blocks).to.have.lengthOf(0)
    })
  })
})
