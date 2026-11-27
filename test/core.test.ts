// 扩展端纯函数：类别判定、符号链、工程映射。

import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { classifyReference, isInTypeArgumentList, Kind } from '../src/core/classify';
import { ProjectIndex, parseProjectFile } from '../src/core/projects';
import { parseSolutionProjects } from '../src/core/solution';
import { containersAt, definitionLabelAt, SymbolKind, SymbolNode } from '../src/core/symbols';

function classify(line: string, word: string, symbolClass: 'type' | 'value' | 'method' | 'unknown', occurrence = 0, highlight?: 0 | 1 | 2): string
{
    let start = -1;
    for (let i = 0; i <= occurrence; i++)
        start = line.indexOf(word, start + 1);
    assert.ok(start >= 0, `用例行里找不到 ${word}`);
    return classifyReference({ line, start, end: start + word.length, symbolClass, highlight, isDefinition: false });
}

test('类型：泛型实参判为类型参数', () =>
{
    assert.equal(classify('var entities = frame.Filter<PlayerLink, HumanoidMotion>();', 'HumanoidMotion', 'type'), Kind.typeArgument);
    assert.equal(classify('if (!frame.TryGet<HumanoidMotion>(entity, out var motion))', 'HumanoidMotion', 'type'), Kind.typeArgument);
    assert.equal(classify('Dictionary<int, (string, HumanoidMotion)> map;', 'HumanoidMotion', 'type'), Kind.typeArgument);
});

test('类型：限定访问判为合格', () =>
{
    assert.equal(classify('var config = HumanoidMotion.ConfigOf(frame, entity);', 'HumanoidMotion', 'type'), Kind.qualified);
});

test('类型：参数类型与局部声明不带类别', () =>
{
    assert.equal(classify('public static FP MovementMagnitude(in HumanoidMotion motion, FP moveSpeed)', 'HumanoidMotion', 'type'), Kind.none);
    assert.equal(classify('HumanoidMotion motion = default;', 'HumanoidMotion', 'type'), Kind.none);
});

test('类型：方法实参与比较运算不误判为类型参数', () =>
{
    assert.equal(isInTypeArgumentList('Call(a, '), false);
    assert.equal(isInTypeArgumentList('if (a < b && '), false);
    assert.equal(isInTypeArgumentList('var x = Get<int>(a, '), false);
    assert.equal(isInTypeArgumentList('Filter<PlayerLink, '), true);
});

test('类型：对象创建、导入、基类、约束', () =>
{
    assert.equal(classify('predicted.Add(duplicate, new HumanoidMotion { Config = x });', 'HumanoidMotion', 'type'), Kind.objectCreation);
    assert.equal(classify('using Quantum.HumanoidMotion;', 'HumanoidMotion', 'type'), Kind.importing);
    assert.equal(classify('public sealed class Binding : MonoBehaviour, IHumanoid', 'IHumanoid', 'type'), Kind.baseType);
    assert.equal(classify('void Run<T>() where T : IHumanoid', 'IHumanoid', 'type'), Kind.typeConstraint);
    assert.equal(classify('var name = nameof(HumanoidMotion);', 'HumanoidMotion', 'type'), Kind.name);
});

test('值：读、写、读写', () =>
{
    assert.equal(classify('var speed = motion.Speed;', 'Speed', 'value'), Kind.read);
    assert.equal(classify('motion.Speed = 3;', 'Speed', 'value'), Kind.write);
    assert.equal(classify('motion.Speed += 3;', 'Speed', 'value'), Kind.readWrite);
    assert.equal(classify('count++;', 'count', 'value'), Kind.readWrite);
    assert.equal(classify('TryGet(out speed);', 'speed', 'value'), Kind.write);
    assert.equal(classify('if (motion.Speed == 3)', 'Speed', 'value'), Kind.read);
    assert.equal(classify('Assign(speed);', 'speed', 'value', 0, 2), Kind.write);
});

test('方法与定义', () =>
{
    assert.equal(classify('PresentationHumanoid.Evaluate(motion);', 'Evaluate', 'method'), Kind.none);
    assert.equal(classifyReference({ line: 'public struct HumanoidMotion', start: 14, end: 28, symbolClass: 'type', isDefinition: true }), Kind.definition);
});

function range(startLine: number, startCharacter: number, endLine: number, endCharacter: number)
{
    return { start: { line: startLine, character: startCharacter }, end: { line: endLine, character: endCharacter } };
}

const tree: SymbolNode[] = [{
    name: 'Quantum',
    kind: SymbolKind.Namespace,
    range: range(0, 0, 100, 1),
    selectionRange: range(0, 10, 0, 17),
    children: [{
        name: 'PresentationHumanoid',
        kind: SymbolKind.Class,
        range: range(2, 0, 90, 1),
        selectionRange: range(2, 13, 2, 33),
        children: [
            {
                name: 'UpdateAnimation(Frame, EntityRef)',
                kind: SymbolKind.Method,
                range: range(10, 4, 30, 5),
                selectionRange: range(10, 17, 10, 32),
            },
            {
                name: 'Pose',
                kind: SymbolKind.Struct,
                range: range(40, 4, 60, 5),
                selectionRange: range(40, 18, 40, 22),
                children: [{
                    name: 'Blend',
                    kind: SymbolKind.Field,
                    range: range(42, 8, 42, 30),
                    selectionRange: range(42, 20, 42, 25),
                }],
            },
        ],
    }],
}];

test('包含成员与包含类型取最内层，成员去掉参数表', () =>
{
    assert.deepEqual(containersAt(tree, { line: 20, character: 8 }, 'HumanoidMotion'), { member: 'UpdateAnimation', type: 'PresentationHumanoid' });
    assert.deepEqual(containersAt(tree, { line: 42, character: 12 }, 'HumanoidMotion'), { member: 'Blend', type: 'PresentationHumanoid.Pose' });
    assert.deepEqual(containersAt(tree, { line: 35, character: 0 }, 'x'), { member: '', type: 'PresentationHumanoid' });
});

test('正在声明的符号不算自己的包含者', () =>
{
    assert.deepEqual(containersAt(tree, { line: 2, character: 15 }, 'PresentationHumanoid'), { member: '', type: '' });
    assert.deepEqual(containersAt(tree, { line: 40, character: 19 }, 'Pose'), { member: '', type: 'PresentationHumanoid' });
});

test('定义标签：类型带关键字和外层类型，成员保留参数表', () =>
{
    assert.deepEqual(definitionLabelAt(tree, { line: 40, character: 19 }, 'Pose'), { label: 'struct PresentationHumanoid.Pose', kind: SymbolKind.Struct });
    assert.deepEqual(definitionLabelAt(tree, { line: 10, character: 20 }, 'UpdateAnimation'),
        { label: 'PresentationHumanoid.UpdateAnimation(Frame, EntityRef)', kind: SymbolKind.Method });
    assert.deepEqual(definitionLabelAt([], { line: 0, character: 0 }, 'Foo'), { label: 'Foo', kind: undefined });
});

test('扁平 SymbolInformation 也能算出包含者', () =>
{
    const flat: SymbolNode[] = [
        { name: 'Outer', kind: SymbolKind.Class, range: range(0, 0, 50, 1) },
        { name: 'Run', kind: SymbolKind.Method, range: range(5, 4, 20, 5) },
    ];
    assert.deepEqual(containersAt(flat, { line: 10, character: 8 }, 'x'), { member: 'Run', type: 'Outer' });
    assert.deepEqual(containersAt(flat, { line: 5, character: 10 }, 'Run'), { member: '', type: 'Outer' });
});

test('Unity 工程按 Compile 清单精确映射，SDK 工程按目录映射', () =>
{
    const root = path.resolve('/work/Client/U3DProject');
    const index = new ProjectIndex();
    index.add(path.join(root, 'Assembly-CSharp.csproj'),
        '<Project><ItemGroup><Compile Include="Assets\\Scripts\\View\\PresentationHumanoid.cs" /></ItemGroup></Project>');
    index.add(path.join(root, 'Assembly-CSharp-Editor.csproj'),
        '<Project><ItemGroup><Compile Include="Assets\\Editor\\Tests\\HumanoidTests.cs" /></ItemGroup></Project>');
    index.add(path.resolve('/work/Shared/Wish/Wish.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>');

    assert.equal(index.resolve(path.join(root, 'Assets/Scripts/View/PresentationHumanoid.cs')), 'Assembly-CSharp');
    assert.equal(index.resolve(path.join(root, 'Assets/Editor/Tests/HumanoidTests.cs')), 'Assembly-CSharp-Editor');
    assert.equal(index.resolve(path.join(root, 'Assets/Other.cs')), undefined);
    assert.equal(index.resolve(path.resolve('/work/Shared/Wish/Sub/A.cs')), 'Wish');
    assert.equal(index.size, 3);
});

test('Compile 项的通配与多值', () =>
{
    const info = parseProjectFile('<Compile Include="A.cs;B.cs" /><Compile Include="**/*.cs" />');
    assert.deepEqual(info.compileIncludes, ['A.cs', 'B.cs']);
    assert.equal(info.usesGlobs, true);
});

test('解决方案：.sln 与 .slnx 里列出的工程', () =>
{
    const root = path.resolve('/repo');
    const sln = [
        'Microsoft Visual Studio Solution File, Format Version 12.00',
        'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Game", "Game\\Game.csproj", "{11111111-1111-1111-1111-111111111111}"',
        'EndProject',
        'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Solution Items", "Solution Items", "{22222222-2222-2222-2222-222222222222}"',
        'EndProject',
        'Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "Tools", "..\\Tools\\Tools.csproj", "{33333333-3333-3333-3333-333333333333}"',
        'EndProject',
    ].join('\r\n');
    assert.deepEqual(parseSolutionProjects(path.join(root, 'Game.sln'), sln), [
        path.join(root, 'Game', 'Game.csproj'),
        path.resolve(root, '..', 'Tools', 'Tools.csproj'),
    ]);
    const slnx = '<Solution>\n  <Folder Name="/src/">\n    <Project Path="src/App/App.csproj" />\n  </Folder>\n  <Project Path="Lib.fsproj" Type="Classic F#" />\n</Solution>';
    assert.deepEqual(parseSolutionProjects(path.join(root, 'App.slnx'), slnx), [
        path.join(root, 'src', 'App', 'App.csproj'),
        path.join(root, 'Lib.fsproj'),
    ]);
});
