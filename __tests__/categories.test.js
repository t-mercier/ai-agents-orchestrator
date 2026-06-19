const categories = require('../renderer/lib/categories')

describe('categories', () => {
  it('exposes a non-empty fallback order', () => {
    expect(Array.isArray(categories.FALLBACK)).toBe(true)
    expect(categories.FALLBACK).toContain('FEAT')
  })

  it('order() returns the fallback when no config is present', () => {
    // In jest there is no `window`, so order() must fall back.
    expect(categories.order()).toEqual(categories.FALLBACK)
  })
})
