const path = require('path')
const os = require('os')
const fs = require('fs')
const config = require('../data/config')

describe('config loader', () => {
  it('returns built-in defaults when no file exists', () => {
    const c = config.load('/nonexistent/config.json')
    expect(c.categories.map(x => x.name)).toContain('FEAT')
    expect(c.workRoot).toBe(path.join(os.homedir(), 'work'))
  })

  it('resolves ~ in category base dirs to absolute paths', () => {
    const c = config.load('/nonexistent/config.json')
    const feat = c.scanDirs.find(d => d.category === 'FEAT')
    expect(path.isAbsolute(feat.base)).toBe(true)
    expect(feat.base.startsWith(os.homedir())).toBe(true)
  })

  it('personal scope resolves under home, work scope under workRoot', () => {
    const c = config.load('/nonexistent/config.json')
    const perso = c.scanDirs.find(d => d.category === 'PERSO')
    const feat = c.scanDirs.find(d => d.category === 'FEAT')
    expect(perso.base).toBe(path.join(os.homedir(), 'PERSO'))
    expect(feat.base).toBe(path.join(os.homedir(), 'work', 'FEAT'))
  })

  it('merges a partial user file over defaults', () => {
    const tmp = path.join(os.tmpdir(), `csm-cfg-${process.pid}.json`)
    fs.writeFileSync(tmp, JSON.stringify({ categories: [{ name: 'WORK', color: '#ffffff', scope: 'work' }] }))
    const c = config.load(tmp)
    expect(c.categories).toHaveLength(1)
    expect(c.categories[0].name).toBe('WORK')
    expect(c.obsidian.enabled).toBe(false) // default preserved
    fs.unlinkSync(tmp)
  })

  it('expands ~ in a user-provided workRoot', () => {
    const tmp = path.join(os.tmpdir(), `csm-cfg2-${process.pid}.json`)
    fs.writeFileSync(tmp, JSON.stringify({ workRoot: '~/Dev' }))
    const c = config.load(tmp)
    expect(c.workRoot).toBe(path.join(os.homedir(), 'Dev'))
    fs.unlinkSync(tmp)
  })

  it('falls back to defaults on malformed JSON', () => {
    const tmp = path.join(os.tmpdir(), `csm-bad-${process.pid}.json`)
    fs.writeFileSync(tmp, '{ not json')
    const c = config.load(tmp)
    expect(c.categories.length).toBeGreaterThan(0)
    fs.unlinkSync(tmp)
  })

  it('colorMap maps category name to color', () => {
    const c = config.load('/nonexistent/config.json')
    expect(c.colorMap.FEAT).toMatch(/^#/)
  })

  it('order lists category names in declared order', () => {
    const c = config.load('/nonexistent/config.json')
    expect(c.order[0]).toBe('FEAT')
  })
})

describe('config.validate', () => {
  it('rejects a category with a bad color', () => {
    expect(config.validate({ categories: [{ name: 'X', color: 'red; }', scope: 'work' }] }).ok).toBe(false)
  })
  it('rejects a bad scope', () => {
    expect(config.validate({ categories: [{ name: 'X', color: '#ffffff', scope: 'lan' }] }).ok).toBe(false)
  })
  it('rejects a bad category name', () => {
    expect(config.validate({ categories: [{ name: 'a b', color: '#ffffff', scope: 'work' }] }).ok).toBe(false)
  })
  it('accepts a clean config', () => {
    expect(config.validate({
      workRoot: '~/W',
      categories: [{ name: 'X', color: '#ffffff', scope: 'work' }],
      obsidian: { enabled: true, vaultPath: '~/V' },
    }).ok).toBe(true)
  })
  it('rejects empty categories', () => {
    expect(config.validate({ categories: [] }).ok).toBe(false)
  })
})
