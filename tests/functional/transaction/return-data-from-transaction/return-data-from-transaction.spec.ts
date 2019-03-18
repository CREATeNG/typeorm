import "reflect-metadata";
import {Connection} from "../../../../src";
import {Post} from "./entity/Post";
import {Category} from "./entity/Category";
import {
    closeTestingConnections,
    createTestingConnections,
    reloadTestingDatabases
} from "../../../../test/utils/test-utils";

describe("transaction > return data from transaction", () => {

    let connections: Connection[];
    beforeAll(async () => connections = await createTestingConnections({
        entities: [__dirname + "/entity/*{.js,.ts}"],
        enabledDrivers: ["mysql", "sqlite", "postgres"] // todo: for some reasons mariadb tests are not passing here
    }));
    beforeEach(() => reloadTestingDatabases(connections));
    afterAll(() => closeTestingConnections(connections));

    test("should allow to return typed data from transaction", () => Promise.all(connections.map(async connection => {

        const { postId, categoryId } = await connection.manager.transaction<{ postId: number, categoryId: number }>(async entityManager => {

            const post = new Post();
            post.title = "Post #1";
            await entityManager.save(post);

            const category = new Category();
            category.name = "Category #1";
            await entityManager.save(category);

            return {
                postId: post.id,
                categoryId: category.id
            };

        });

        const post = await connection.manager.findOne(Post, { where: { title: "Post #1" }});
        expect(post).not.toBeUndefined();
        expect(post!).toEqual({
            id: postId,
            title: "Post #1"
        });

        const category = await connection.manager.findOne(Category, { where: { name: "Category #1" }});
        expect(category).not.toBeUndefined();
        expect(category!).toEqual({
            id: categoryId,
            name: "Category #1"
        });

    })));

    test("should allow to return typed data from transaction using type inference", () => Promise.all(connections.map(async connection => {

        const { postId, categoryId } = await connection.manager.transaction(async entityManager => {

            const post = new Post();
            post.title = "Post #1";
            await entityManager.save(post);

            const category = new Category();
            category.name = "Category #1";
            await entityManager.save(category);

            return {
                postId: post.id,
                categoryId: category.id
            };

        });

        const post = await connection.manager.findOne(Post, { where: { title: "Post #1" }});
        expect(post).not.toBeUndefined();
        expect(post!).toEqual({
            id: postId,
            title: "Post #1"
        });

        const category = await connection.manager.findOne(Category, { where: { name: "Category #1" }});
        expect(category).not.toBeUndefined();
        expect(category!).toEqual({
            id: categoryId,
            name: "Category #1"
        });

    })));

});