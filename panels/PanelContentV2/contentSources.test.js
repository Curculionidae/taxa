import { test } from 'node:test'
import assert from 'node:assert/strict'
import { otuNameHtml, groupByTopic, loadContents } from './contentSources.js'

const SYNONYM_TAG =
  '<span class="otu_tag"><i>Lixus</i> <i>punctiventris</i> Boheman, 1835 <em>now</em> <i>Lixus</i> <i>abdominalis</i> Boheman, 1835</span>'

test('the name of a synonym OTU leaves out the valid name', () => {
  assert.equal(
    otuNameHtml({ object_tag: SYNONYM_TAG }),
    '<i>Lixus</i> <i>punctiventris</i> Boheman, 1835'
  )
})

test('the "now" marker is found whatever the whitespace around it', () => {
  assert.equal(otuNameHtml({ object_tag: '<i>Aus</i> <em>now</em>&nbsp;<i>Bus</i>' }), '<i>Aus</i>')
})

test('an OTU with a name of its own goes by that name, escaped', () => {
  assert.equal(
    otuNameHtml({
      name: 'Carex sp. <A>',
      object_tag: '<span class="otu_tag"><i>Carex</i>&nbsp;<b>Carex sp.</b></span>'
    }),
    'Carex sp. &lt;A&gt;'
  )
})

test('an OTU without a tag has an empty name', () => {
  assert.equal(otuNameHtml({}), '')
  assert.equal(otuNameHtml(null), '')
})

test('texts are grouped by topic in the order the topics first appear', () => {
  assert.deepEqual(
    groupByTopic([
      { name: 'Biology', text: 'a' },
      { name: 'Synonymy', text: 'b', otuNameHtml: 'X' },
      { name: 'Biology', text: 'c' }
    ]),
    [
      {
        title: 'Biology',
        entries: [
          { text: 'a', otuNameHtml: '', citations: [] },
          { text: 'c', otuNameHtml: '', citations: [] }
        ]
      },
      {
        title: 'Synonymy',
        entries: [{ text: 'b', otuNameHtml: 'X', citations: [] }]
      }
    ]
  )
})

// A fake API: answers by URL, records the calls.
function fakeApi(answers) {
  const calls = []

  return {
    calls,
    get(url, options) {
      calls.push({ url, params: options?.params })
      const answer = answers[url]

      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve({ data: answer ?? [] })
    }
  }
}

test('a valid taxon also gets the content of its other OTUs that have any: synonyms and OTUs on its own name', async () => {
  const api = fakeApi({
    '/otus': [
      { id: 2, taxon_name_id: 20, object_tag: 'valid' },
      { id: 1, taxon_name_id: 10, object_tag: SYNONYM_TAG },
      { id: 3, taxon_name_id: 30, object_tag: 'empty synonym' },
      {
        id: 4,
        taxon_name_id: 20,
        name: 'Carex sp.',
        object_tag: '<span class="otu_tag"><i>Carex</i>&nbsp;<b>Carex sp.</b></span>'
      }
    ],
    '/contents': [{ otu_id: 1 }, { otu_id: 4 }],
    '/otus/1/inventory/content': [{ name: 'Synonymy', text: 's' }],
    '/otus/4/inventory/content': [{ name: 'Biology', text: 'c' }]
  })

  const contents = await loadContents(api, {
    otuId: 2,
    isValid: true,
    ownRequest: Promise.resolve({ data: [{ name: 'Biology', text: 'o' }] })
  })

  assert.deepEqual(contents, [
    { name: 'Biology', text: 'o' },
    {
      name: 'Synonymy',
      text: 's',
      otuNameHtml: '<i>Lixus</i> <i>punctiventris</i> Boheman, 1835'
    },
    { name: 'Biology', text: 'c', otuNameHtml: 'Carex sp.' }
  ])
  assert.deepEqual(
    api.calls.map((call) => call.url),
    [
      '/otus',
      '/contents',
      '/otus/1/inventory/content',
      '/otus/4/inventory/content'
    ]
  )
  assert.deepEqual(api.calls[1].params.otu_id, [1, 3, 4])
})

test('a taxon without other OTUs never asks /contents', async () => {
  const api = fakeApi({ '/otus': [{ id: 2 }] })

  await loadContents(api, {
    otuId: 2,
    isValid: true,
    ownRequest: Promise.resolve({ data: [] })
  })

  assert.deepEqual(
    api.calls.map((call) => call.url),
    ['/otus']
  )
})

test('the page of a synonym shows only its own content', async () => {
  const api = fakeApi({})

  const contents = await loadContents(api, {
    otuId: 1,
    isValid: false,
    ownRequest: Promise.resolve({ data: [{ name: 'Synonymy', text: 's' }] })
  })

  assert.deepEqual(contents, [{ name: 'Synonymy', text: 's' }])
  assert.equal(api.calls.length, 0)
})

test('a failed synonym lookup still shows the own content', async () => {
  const api = fakeApi({ '/otus': new Error('down') })

  const contents = await loadContents(api, {
    otuId: 2,
    isValid: true,
    ownRequest: Promise.resolve({ data: [{ name: 'Biology', text: 'o' }] })
  })

  assert.deepEqual(contents, [{ name: 'Biology', text: 'o' }])
})

test('each text gets the citations of its own content record', async () => {
  const api = fakeApi({
    '/otus': [
      { id: 2, taxon_name_id: 20 },
      { id: 1, taxon_name_id: 10, object_tag: 'syn' }
    ],
    '/contents': [{ otu_id: 1 }],
    '/otus/1/inventory/content': [{ content_id: 11, name: 'Synonymy', text: 's' }],
    '/citations': [
      { id: 1, citation_object_id: 11 },
      { id: 2, citation_object_id: 10 },
      { id: 3, citation_object_id: 11 }
    ]
  })

  const contents = await loadContents(api, {
    otuId: 2,
    isValid: true,
    ownRequest: Promise.resolve({
      data: [
        { content_id: 10, name: 'Biology', text: 'o' },
        { content_id: 12, name: 'Biology', text: 'p' }
      ]
    })
  })

  assert.deepEqual(
    contents.map((item) => item.citations.map((citation) => citation.id)),
    [[2], [], [1, 3]]
  )

  const { params } = api.calls.at(-1)

  assert.equal(params.citation_object_type, 'Content')
  assert.deepEqual(params.citation_object_id, [10, 12, 11])
})

test('a failed citation lookup still shows the texts', async () => {
  const api = fakeApi({ '/citations': new Error('down') })

  const contents = await loadContents(api, {
    otuId: 1,
    isValid: false,
    ownRequest: Promise.resolve({
      data: [{ content_id: 10, name: 'Biology', text: 'o' }]
    })
  })

  assert.deepEqual(contents, [
    { content_id: 10, name: 'Biology', text: 'o', citations: [] }
  ])
})
