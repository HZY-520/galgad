#!/usr/bin/env node
/**
 * check-methods.mjs —— 页面「方法存在性」静态检查（防止 this.xxx is not a function）。
 *
 * 背景：BlueOS 页面对象里 `this.xxx()` 调用只会在运行时才暴露；模板事件处理器的
 * 存在性 validator 已覆盖，但**页面内部互相调用**（例如 onTap 里调 this.endHold()）
 * 一旦方法名拼错/漏写就会在真机/模拟器点击时抛 "not a function"，字幕卡住不动。
 * 本脚本扫描 src 下所有 .ux 的 <script>，收集 `this.name(` 调用与对象字面量里的方法
 * 定义，报告缺失项；同时把「模板事件处理器」也纳入检查。
 *
 * 用法：node tools/check-methods.mjs [--root .]
 * 退出码：0 = 无缺失；1 = 有缺失。
 */
'use strict'

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 页面 VM 内置 / 框架注入的成员，不需要在对象字面量里定义 */
const BUILTINS = new Set([
  '$app', '$page', '$device', '$element', '$set', '$delete', '$watch', '$nextTick', '$res', '$valid',
])

function walkUx(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'build', 'dist'].includes(entry.name)) continue
      walkUx(full, out)
    } else if (entry.isFile() && entry.name.endsWith('.ux')) {
      out.push(full)
    }
  }
  return out
}

function block(text, name) {
  const m = text.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'))
  return m ? m[1] : ''
}

/** 收集对象字面量中「方法定义」的名称：name(...) {  /  name: (…) => / name: function */
function definedMethods(script) {
  const names = new Set()
  const re = /^\s{2,}([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm
  let m
  while ((m = re.exec(script))) names.add(m[1])
  const reArrow = /^\s{2,}([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/gm
  while ((m = reArrow.exec(script))) names.add(m[1])
  return names
}

/** 去掉注释后再做调用扫描（注释里提到 this.xxx() 不应算作缺失） */
function stripComments(code) {
  let out = code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  out = out.replace(/^[ \t]*\/\/.*$/gm, '')
  return out
}

/** 收集 this.xxx( 的调用（排除 this.$builtin 与属性访问后紧跟非括号的情况） */
function thisCalls(script) {
  const out = []
  const code = stripComments(script)
  const re = /this\.([A-Za-z_$][\w$]*)\s*\(/g
  let m
  while ((m = re.exec(code))) {
    const name = m[1]
    if (BUILTINS.has(name)) continue
    const line = code.slice(0, m.index).split('\n').length
    out.push({ name, line })
  }
  return out
}

/** 模板里 @click="handler" / onclick="handler" 的事件处理器名 */
function templateHandlers(template) {
  const out = []
  const re = /(?:@|on)([a-z]+)\s*=\s*"([A-Za-z_$][\w$]*)\s*(?:\(|")/g
  let m
  while ((m = re.exec(template))) out.push({ event: m[1], name: m[2] })
  return out
}

function checkFile(file) {
  const text = fs.readFileSync(file, 'utf8')
  const script = block(text, 'script')
  const template = block(text, 'template')
  const defined = definedMethods(script)
  const calls = thisCalls(script)
  const handlers = templateHandlers(template)
  const errors = []

  for (const call of calls) {
    if (!defined.has(call.name)) {
      errors.push({
        kind: 'this-call',
        name: call.name,
        line: call.line,
        message: `this.${call.name}() 在页面对象里没有定义（运行时会抛 not a function）`,
      })
    }
  }
  for (const h of handlers) {
    if (!defined.has(h.name)) {
      errors.push({
        kind: 'template-handler',
        name: h.name,
        line: 0,
        message: `模板 @${h.event}="${h.name}" 在 script 里没有定义`,
      })
    }
  }
  return { file, definedCount: defined.size, callCount: calls.length, handlerCount: handlers.length, errors }
}

function main() {
  const argv = process.argv.slice(2)
  let root = ROOT
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') root = path.resolve(argv[i + 1])
  }
  const srcDir = path.join(root, 'src')
  const files = walkUx(srcDir, [])
  console.log('==== 页面方法存在性检查 (tools/check-methods.mjs) ====')
  console.log(`扫描: ${path.relative(process.cwd(), srcDir).replace(/\\/g, '/')}  共 ${files.length} 个 .ux 文件`)
  let totalErrors = 0
  const results = []
  for (const file of files.sort()) {
    const r = checkFile(file)
    results.push(r)
    const rel = path.relative(root, file).replace(/\\/g, '/')
    if (r.errors.length === 0) {
      console.log(`  [PASS] ${rel}  (方法 ${r.definedCount} / this 调用 ${r.callCount} / 模板处理器 ${r.handlerCount})`)
      continue
    }
    totalErrors += r.errors.length
    console.log(`  [FAIL] ${rel}`)
    for (const e of r.errors) console.log(`      [${e.kind}] ${e.message}${e.line ? '（第 ' + e.line + ' 行附近）' : ''}`)
  }
  console.log('')
  console.log(`[check-methods] 结果: ${totalErrors === 0 ? 'PASS' : 'FAIL'}  errors=${totalErrors}  files=${files.length}`)
  const outDir = path.join(root, 'scripts', 'reports')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(
    path.join(outDir, 'check-methods.json'),
    JSON.stringify({ tool: 'tools/check-methods.mjs', files: files.length, errors: totalErrors, results, generatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  )
  process.exit(totalErrors === 0 ? 0 : 1)
}

main()
