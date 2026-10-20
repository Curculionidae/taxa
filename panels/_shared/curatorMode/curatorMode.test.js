import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readCuratorSwitch } from './curatorMode.js'

describe('readCuratorSwitch', () => {
  it('reads the switch in the hash route', () => {
    assert.equal(readCuratorSwitch('https://x.org/#/otus/1/overview?curator=1'), '1')
    assert.equal(readCuratorSwitch('https://x.org/#/bibliography/search?page=2&curator=0'), '0')
  })

  it('reads the switch before the hash', () => {
    assert.equal(readCuratorSwitch('https://x.org/?curator=1#/otus/1'), '1')
  })

  it('is null without a switch or with a broken URL', () => {
    assert.equal(readCuratorSwitch('https://x.org/#/otus/1'), null)
    assert.equal(readCuratorSwitch('not a url'), null)
  })
})
